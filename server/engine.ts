import type {
  BuildGenerationRequest,
  BuildGenerationDiagnostic,
  BuildGenerationRecoveryOption,
  BuildGenerationResult,
  BuildSelection,
  BuildMetrics,
  BuildAnalysis,
  BuildAnalysisBalance,
  BuildAnalysisFactor,
  BuildAnalysisInsight,
  BuildBottleneck,
  CompatibilityLink,
  CompatibilityResult,
  Finding,
  FindingAction,
  FindingFact,
  FindingSeverity,
  GamingResolution,
  GamingRefreshRate,
  GpuTargetEvidence,
  GpuTargetFit,
  ListingPolicy,
  MemoryProfile,
  Part,
  PartCategory,
  PartSelection,
  PciePowerConnectorKind,
  PciePowerRequirement,
  RecommendationPlan,
  RecommendationProfile,
  RecommendationPreferences,
  RecommendationSearchSummary,
  AlternativeRisk,
  UpgradeCompatibilityEvidence,
  UpgradeExpansionEvidence,
  UpgradeBudgetEvidence,
  UpgradeBundleRecommendation,
  UpgradeBundleSearchSummary,
  SimilarityConfidence,
  SimilarityBasis,
  SimilarityDimensionEvidence,
  SimilarityEvidence,
  Suggestion,
  PhysicalEvidenceSummary,
  UpgradeRecommendation,
  GeneratedBuildLine,
  ValueEvidence,
  ValueLabel,
  M2SlotAssignment,
  M2SlotProfile
} from "../shared/types";
import { CATEGORY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_RESOLUTION_VRAM_TARGETS, isKnownPrice, LISTING_POLICY_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { savedBuildComparisonExpansionFor } from "../shared/saved-build-comparison";
import { VALUE_SCORE_MAX } from "../shared/value-score";
import { gpuFitSummaryFor, gpuPurchaseEvidenceFor, pcieCableTopologyStatusFor, pciePowerMatchFor } from "../shared/gpu-fit";
import { physicalSourceCheckNeedsReview } from "../shared/physical-source-check";
import { isListingAllowed } from "./listing";
import { compareRecommendationTrust, recommendationTrustFor } from "./recommendation-trust";

export const ENGINE_VERSION = "2.56.0";

const GPU_THICKNESS_WARNING_MM = 55;
const MAX_EVALUATION_CACHE_ENTRIES = 4096;
const REPAIR_PLAN_OPTIONS_PER_CATEGORY = 4;
const CANDIDATE_EVALUATION_POOL_SIZE = 192;
const BUNDLE_CANDIDATE_MAX_PER_CATEGORY = 4;
const BUNDLE_CANDIDATE_MAX_TOTAL = 24;
const BUNDLE_BEAM_WIDTH = 24;

type EvaluationCache = Map<string, CompatibilityResult>;
const catalogPartIndexCache = new WeakMap<Part[], Map<string, Part>>();

type EngineOptions = {
  includeSuggestions?: boolean;
  includeAnalysis?: boolean;
  catalogSnapshotAt?: string;
  recommendationPreferences?: RecommendationPreferences;
  evaluationCache?: EvaluationCache;
};

type RecommendationSearchContext = Omit<RecommendationSearchSummary, "mode"> & { bounded: boolean };

function recommendationSearchSummaryFor(context: RecommendationSearchContext): RecommendationSearchSummary {
  return {
    mode: context.bounded ? "bounded" : "exhaustive",
    candidateSetCount: context.candidateSetCount,
    candidateCount: context.candidateCount,
    evaluatedCandidateCount: context.evaluatedCandidateCount,
    maxEvaluatedCandidatesPerSet: context.maxEvaluatedCandidatesPerSet
  };
}

function evaluationCacheKeyFor(build: BuildSelection) {
  return JSON.stringify(build);
}

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

type SelectionWithPart = {
  selection: PartSelection;
  part: Part;
};

const PROFILE_SUMMARIES: Record<RecommendationProfile, string> = {
  general: `${RECOMMENDATION_PROFILE_LABELS.general} 기준 · 호환성과 현재 스펙 유사도를 우선 비교합니다.`,
  gaming: `${RECOMMENDATION_PROFILE_LABELS.gaming} 기준 · GPU VRAM·그래픽 처리 여유·메모리 속도를 더 중요하게 봅니다.`,
  creator: `${RECOMMENDATION_PROFILE_LABELS.creator} 기준 · CPU 병렬성·메모리 용량·SSD 쓰기 성능을 더 중요하게 봅니다.`,
  development: `${RECOMMENDATION_PROFILE_LABELS.development} 기준 · CPU 병렬성·메모리 용량·저장장치 용량을 더 중요하게 봅니다.`,
  office: `${RECOMMENDATION_PROFILE_LABELS.office} 기준 · 기본 성능·확장성·가격 변화를 함께 비교합니다.`
};

type ProfileWeightMap = Partial<Record<PartCategory, Record<string, number>>>;

const PROFILE_WEIGHT_OVERRIDES: Record<RecommendationProfile, ProfileWeightMap> = {
  general: {},
  gaming: {
    cpu: { cinebenchR23Single: 6, cinebenchR23Multi: 3, boostClockGhz: 5, cores: 2, threads: 2 },
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

const DEFAULT_GAMING_RESOLUTION: GamingResolution = "1440p";
const DEFAULT_GAMING_REFRESH_RATE: GamingRefreshRate = 144;
const GAMING_REFRESH_RATE_WEIGHT_OVERRIDES: Record<GamingRefreshRate, Partial<Record<PartCategory, Record<string, number>>>> = {
  60: {
    cpu: { cinebenchR23Single: 5, cinebenchR23Multi: 6, cores: 4, threads: 3, boostClockGhz: 2 },
    gpu: { gpu3dmarkTimeSpyScore: 5, gpu3dmarkPortRoyalScore: 4, gpuStreamProcessors: 5, gpuMemoryBandwidthGbps: 4, gpuBoostClockMhz: 2 }
  },
  144: {
    cpu: { cinebenchR23Single: 7, cinebenchR23Multi: 7, cores: 4, threads: 3, boostClockGhz: 2 },
    gpu: { gpu3dmarkTimeSpyScore: 7, gpu3dmarkPortRoyalScore: 5, gpuStreamProcessors: 6, gpuMemoryBandwidthGbps: 6, gpuBoostClockMhz: 2 }
  },
  240: {
    cpu: { cinebenchR23Single: 10, cinebenchR23Multi: 7, cores: 5, threads: 3, boostClockGhz: 4 },
    gpu: { gpu3dmarkTimeSpyScore: 9, gpu3dmarkPortRoyalScore: 5, gpuStreamProcessors: 8, gpuMemoryBandwidthGbps: 6, gpuBoostClockMhz: 3 }
  }
};

function profileSummaryFor(profile: RecommendationProfile) {
  return PROFILE_SUMMARIES[profile];
}

function gpuTargetFitFor(vramGb: number | undefined, targetVramGb: number): GpuTargetFit {
  if (vramGb === undefined || !Number.isFinite(vramGb) || vramGb <= 0) return "unknown";
  return vramGb >= targetVramGb ? "met" : "partial";
}

function gpuTargetFitLabel(fit: GpuTargetFit) {
  return fit === "met" ? "권장 기준 충족" : fit === "partial" ? "권장 기준 미달" : "VRAM 확인 필요";
}

function formatTargetVram(vramGb: number | undefined) {
  return vramGb === undefined ? "확인 불가" : `${vramGb}GB`;
}

function gpuTargetEvidenceFor(current: Part, candidate: Part | undefined, resolution: GamingResolution, refreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE): GpuTargetEvidence | undefined {
  if (current.category !== "gpu") return undefined;
  const targetVramGb = GAMING_RESOLUTION_VRAM_TARGETS[resolution];
  const currentVramGb = current.specs.vramGb;
  const candidateVramGb = candidate?.specs.vramGb;
  const currentFit = gpuTargetFitFor(currentVramGb, targetVramGb);
  const candidateFit = candidate ? gpuTargetFitFor(candidateVramGb, targetVramGb) : undefined;
  const resolutionLabel = GAMING_RESOLUTION_LABELS[resolution];
  const refreshRateLabel = GAMING_REFRESH_RATE_LABELS[refreshRate];
  const summary = candidate
    ? `${resolutionLabel} · ${refreshRateLabel} · 권장 VRAM ${targetVramGb}GB · 현재 ${formatTargetVram(currentVramGb)} → 후보 ${formatTargetVram(candidateVramGb)} · ${gpuTargetFitLabel(candidateFit ?? "unknown")}`
    : `${resolutionLabel} · ${refreshRateLabel} · 권장 VRAM ${targetVramGb}GB · 현재 ${formatTargetVram(currentVramGb)} · ${gpuTargetFitLabel(currentFit)}`;
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

function gpuTargetScoreFor(part: Part, resolution: GamingResolution) {
  if (part.category !== "gpu") return undefined;
  const targetVramGb = GAMING_RESOLUTION_VRAM_TARGETS[resolution];
  const vramGb = part.specs.vramGb;
  if (vramGb === undefined || !Number.isFinite(vramGb) || vramGb <= 0) return 50;
  return Math.max(0, Math.min(100, Math.round((vramGb / targetVramGb) * 100)));
}

const ANALYSIS_SCORE_BASIS = "실제 벤치마크·FPS가 아닌, 현재 카탈로그의 확인된 스펙을 같은 범주 안에서 비교한 상대 지수입니다.";

function emptyBuildAnalysis(profile: RecommendationProfile): BuildAnalysis {
  return {
    profile,
    scoreLabel: "계산 불가",
    scoreBasis: ANALYSIS_SCORE_BASIS,
    confidence: "unknown",
    factors: [],
    strengths: [],
    focusAreas: [],
    bottlenecks: [],
    nextActions: []
  };
}

const severityRank: Record<FindingSeverity, number> = {
  blocker: 0,
  unknown: 1,
  warning: 2,
  info: 3
};

function candidateCompatibilityDeltaFindings(baseline: CompatibilityResult, evaluation: CompatibilityResult, candidateId: string) {
  const baselineByRule = new Map(baseline.findings.map((finding) => [finding.ruleId, finding]));
  return evaluation.findings
    .filter((finding) => finding.affectedPartIds.includes(candidateId))
    .filter((finding) => {
      const previous = baselineByRule.get(finding.ruleId);
      return !previous || severityRank[finding.severity] < severityRank[previous.severity];
    });
}

function selectedPart(catalog: Part[], selection: PartSelection | undefined) {
  if (!selection) return undefined;
  return catalogPartIndexFor(catalog).get(selection.partId);
}

function selectedParts(catalog: Part[], selections: PartSelection[]) {
  return selections
    .map((selection) => {
      const part = selectedPart(catalog, selection);
      return part ? { selection, part } : undefined;
    })
    .filter((item): item is SelectionWithPart => Boolean(item));
}

function physicalMemoryModuleCount(memory: SelectionWithPart[]) {
  return memory.reduce(
    (total, { selection, part }) => total + selection.quantity * (part.specs.memoryModuleCountPerKit ?? 1),
    0
  );
}

function partIds(...parts: Array<Part | undefined>) {
  return parts.filter((part): part is Part => Boolean(part)).map((part) => part.id);
}

function formatNumber(value: number | undefined, suffix = "") {
  return value === undefined ? "확인할 수 없음" : `${value.toLocaleString("ko-KR")}${suffix}`;
}

function radiatorPositionLabel(position: string) {
  return ({ front: "전면", top: "상단", bottom: "하단", side: "측면", rear: "후면" } as Record<string, string>)[position] ?? position;
}

function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function action(
  type: FindingAction["type"],
  label: string,
  targetCategory?: PartCategory
): FindingAction {
  return { type, label, targetCategory };
}

function replaceAction(category: PartCategory, label = `${CATEGORY_LABELS[category]} 바꾸기`) {
  return action("replace_part", label, category);
}

function pciePowerConnectorLabel(kind: PciePowerConnectorKind) {
  if (kind === "12v2x6") return "16핀(12V2x6)";
  if (kind === "12vhpwr") return "16핀(12VHPWR)";
  return kind === "pcie_8pin_6plus2" ? "8핀(6+2)" : "6핀";
}

function formatPciePowerRequirements(requirements: PciePowerRequirement[]) {
  return requirements
    .map((requirement) => `${pciePowerConnectorLabel(requirement.kind)} ${requirement.count}개`)
    .join(" + ");
}

function formatPciePowerOptions(options: PciePowerRequirement[][]) {
  return options.map((option) => formatPciePowerRequirements(option)).join(" 또는 ");
}

function formatPciePowerConnectors(connectors: Partial<Record<PciePowerConnectorKind, number>>) {
  const entries = (Object.entries(connectors) as Array<[PciePowerConnectorKind, number | undefined]>)
    .filter(([, count]) => count !== undefined)
    .map(([kind, count]) => `${pciePowerConnectorLabel(kind)} ${count}개`);
  return entries.length > 0 ? entries.join(" + ") : "확인된 커넥터 없음";
}

function pcieEightPinRequirementCount(requirements: PciePowerRequirement[]) {
  return requirements
    .filter((requirement) => requirement.kind === "pcie_8pin_6plus2")
    .reduce((total, requirement) => total + requirement.count, 0);
}

function isFullyCompatible(blockerCount: number, warningCount: number, unknownCount: number) {
  return blockerCount === 0 && warningCount === 0 && unknownCount === 0;
}

function remainingIssueSummary(blockerCount: number, warningCount: number, unknownCount: number) {
  return `남은 차단 오류 ${blockerCount}개 · 주의 ${warningCount}개 · 확인 필요 ${unknownCount}개`;
}

function formatMemoryProfiles(profiles: MemoryProfile[] | undefined) {
  return profiles && profiles.length > 0 ? profiles.join(" / ") : "확인 필요";
}

function addFinding(
  findings: Finding[],
  ruleId: string,
  severity: FindingSeverity,
  title: string,
  message: string,
  affectedPartIds: string[],
  facts: FindingFact[],
  actions: FindingAction[]
) {
  findings.push({
    id: `${ruleId}-${findings.length + 1}`,
    ruleId,
    severity,
    title,
    message,
    affectedPartIds,
    facts,
    actions
  });
}

function addUnknown(
  findings: Finding[],
  ruleId: string,
  title: string,
  message: string,
  ids: string[],
  missingFields: string[],
  targetCategory?: PartCategory
) {
  addFinding(
    findings,
    ruleId,
    "unknown",
    title,
    message,
    ids,
    missingFields.map((field) => ({ label: "누락된 정보", actual: field })),
    [action("verify_spec", targetCategory ? `${CATEGORY_LABELS[targetCategory]} 스펙 확인` : "제조사 스펙 확인", targetCategory)]
  );
}

function cloneBuild(build: BuildSelection): BuildSelection {
  return {
    ...build,
    memory: build.memory.map((item) => ({ ...item })),
    ssd: build.ssd.map((item) => ({ ...item })),
    hdd: build.hdd.map((item) => ({ ...item })),
    accessories: build.accessories?.map((item) => ({ ...item })),
    m2SlotSelection: build.m2SlotSelection ? { ...build.m2SlotSelection } : undefined
  };
}

function recommendedMemoryKitQuantity(build: BuildSelection, catalog: Part[], candidate: Part) {
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

function replaceSelection(build: BuildSelection, category: PartCategory, partId: string, quantityOverride?: number): BuildSelection {
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

function buildPriceInfo(catalog: Part[], build: BuildSelection) {
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

type ExpandedM2Part = {
  part: Part;
  unitIndex: number;
};

function expandedM2Parts(ssds: SelectionWithPart[]) {
  const units: ExpandedM2Part[] = [];
  for (const { selection, part } of ssds) {
    if (!part.specs.formFactor?.toLowerCase().includes("m.2")) continue;
    for (let unitIndex = 0; unitIndex < Math.max(0, selection.quantity); unitIndex += 1) {
      units.push({ part, unitIndex });
    }
  }
  return units;
}

function m2SlotProfileCanAccept(part: Part, profile: M2SlotProfile) {
  const interfaceName = part.specs.interface === "NVMe" || part.specs.interface === "SATA" ? part.specs.interface : undefined;
  return !interfaceName || !profile.interfaces || profile.interfaces.length === 0 || profile.interfaces.includes(interfaceName);
}

function m2SlotAssignmentScore(part: Part, profile: M2SlotProfile) {
  let score = 0;
  const interfaceName = part.specs.interface === "NVMe" || part.specs.interface === "SATA" ? part.specs.interface : undefined;
  if (interfaceName && profile.interfaces?.includes(interfaceName)) score += 8;
  const ssdGeneration = part.specs.m2PcieGeneration;
  if (ssdGeneration !== undefined && profile.pcieGeneration !== undefined) {
    score += profile.pcieGeneration === ssdGeneration ? 12 : profile.pcieGeneration > ssdGeneration ? 10 : 1;
  }
  if (profile.connection === "cpu" && ssdGeneration !== undefined) score += 1;
  return score;
}

function m2SlotAssignmentFrom(unit: ExpandedM2Part, profile: M2SlotProfile): M2SlotAssignment {
  const ssdPcieGeneration = unit.part.specs.m2PcieGeneration;
  const slotPcieGeneration = profile.pcieGeneration;
  return {
    slotId: profile.slotId,
    partId: unit.part.id,
    partName: unit.part.name,
    interface: unit.part.specs.interface === "NVMe" || unit.part.specs.interface === "SATA" ? unit.part.specs.interface : undefined,
    ssdPcieGeneration,
    slotPcieGeneration,
    linkGeneration: ssdPcieGeneration !== undefined && slotPcieGeneration !== undefined
      ? Math.min(ssdPcieGeneration, slotPcieGeneration)
      : undefined,
    connection: profile.connection,
    sharedWith: profile.sharedWith
  };
}

function assignM2SlotProfiles(motherboard: Part, ssds: SelectionWithPart[]) {
  const profiles = motherboard.specs.m2SlotProfiles;
  if (!profiles || profiles.length === 0) return undefined;
  const units = expandedM2Parts(ssds);
  if (units.length === 0) return [] as M2SlotAssignment[];
  const orderedUnits = units.slice().sort((left, right) => (right.part.specs.m2PcieGeneration ?? 0) - (left.part.specs.m2PcieGeneration ?? 0) || left.part.id.localeCompare(right.part.id));

  let best: { score: number; assignments: Array<{ unit: ExpandedM2Part; profile: M2SlotProfile }> } | undefined;
  const visit = (
    index: number,
    available: M2SlotProfile[],
    assignments: Array<{ unit: ExpandedM2Part; profile: M2SlotProfile }>,
    score: number
  ) => {
    if (index >= units.length) {
      if (!best || score > best.score) best = { score, assignments: [...assignments] };
      return;
    }
    const unit = orderedUnits[index];
    const possible = available
      .filter((profile) => m2SlotProfileCanAccept(unit.part, profile))
      .sort((left, right) => m2SlotAssignmentScore(unit.part, right) - m2SlotAssignmentScore(unit.part, left) || left.slotId.localeCompare(right.slotId));
    for (const profile of possible) {
      visit(
        index + 1,
        available.filter((candidate) => candidate.slotId !== profile.slotId),
        [...assignments, { unit, profile }],
        score + m2SlotAssignmentScore(unit.part, profile)
      );
    }
  };
  visit(0, profiles, [], 0);
  if (!best || best.assignments.length !== units.length) return undefined;
  return best.assignments
    .map(({ unit, profile }) => m2SlotAssignmentFrom(unit, profile))
    .sort((left, right) => left.slotId.localeCompare(right.slotId));
}

function m2SlotProfilesAreComplete(motherboard: Part, m2Slots: number | undefined, m2Parts: SelectionWithPart[]) {
  const profiles = motherboard.specs.m2SlotProfiles;
  if (!profiles || m2Slots === undefined || profiles.length !== m2Slots || m2Parts.length === 0) return false;
  const expectedSlotIds = new Set(Array.from({ length: m2Slots }, (_value, index) => `M2_${index + 1}`));
  if (new Set(profiles.map((profile) => profile.slotId)).size !== m2Slots || profiles.some((profile) => !expectedSlotIds.has(profile.slotId))) return false;
  if (profiles.some((profile) => !profile.interfaces || profile.interfaces.length === 0 || profile.pcieGeneration === undefined || !profile.connection || profile.connection === "unknown" || profile.sharedWith === undefined)) return false;
  return m2Parts.every(({ part }) => part.specs.interface === "NVMe" || part.specs.interface === "SATA");
}

type M2SlotResolution = {
  profilesConfigured: boolean;
  profilesComplete: boolean;
  manual: boolean;
  assignments?: M2SlotAssignment[];
  compatible: boolean;
  error?: string;
};

function resolveM2SlotAssignments(
  motherboard: Part | undefined,
  ssds: SelectionWithPart[],
  requestedSelection: Record<string, string> | undefined
): M2SlotResolution {
  const manual = requestedSelection !== undefined && Object.keys(requestedSelection).length > 0;
  const profiles = motherboard?.specs.m2SlotProfiles;
  const m2Parts = ssds.filter(({ part }) => part.specs.formFactor?.toLowerCase().includes("m.2"));
  const m2Slots = motherboard?.specs.m2Slots;
  const m2Count = m2Parts.reduce((total, { selection }) => total + selection.quantity, 0);
  const profilesConfigured = Boolean(profiles && profiles.length > 0);
  const profilesComplete = Boolean(
    motherboard
      && m2Slots !== undefined
      && m2Count <= m2Slots
      && m2SlotProfilesAreComplete(motherboard, m2Slots, m2Parts)
  );

  if (m2Count === 0) {
    return {
      profilesConfigured,
      profilesComplete: false,
      manual,
      compatible: !manual,
      ...(manual ? { error: "선택한 M.2 SSD가 없어 슬롯 배치를 적용할 수 없습니다." } : {})
    };
  }
  if (!profilesComplete || !motherboard || !profiles) {
    return {
      profilesConfigured,
      profilesComplete: false,
      manual,
      compatible: false,
      ...(manual ? { error: "메인보드의 슬롯별 M.2 정보가 완전하지 않아 수동 배치를 적용할 수 없습니다." } : {})
    };
  }

  if (!manual) {
    const assignments = assignM2SlotProfiles(motherboard, ssds);
    return {
      profilesConfigured,
      profilesComplete: true,
      manual: false,
      assignments,
      compatible: assignments !== undefined
    };
  }

  const entries = Object.entries(requestedSelection);
  if (entries.length !== m2Count) {
    return {
      profilesConfigured,
      profilesComplete: true,
      manual: true,
      compatible: false,
      error: `선택한 M.2 SSD ${m2Count}개와 지정한 슬롯 ${entries.length}개의 수가 맞지 않습니다.`
    };
  }

  const profilesBySlot = new Map(profiles.map((profile) => [profile.slotId, profile]));
  const unitsByPart = new Map<string, ExpandedM2Part[]>();
  for (const unit of expandedM2Parts(ssds)) {
    const units = unitsByPart.get(unit.part.id) ?? [];
    units.push(unit);
    unitsByPart.set(unit.part.id, units);
  }
  const assignments: M2SlotAssignment[] = [];
  for (const [slotId, rawPartId] of entries) {
    const profile = profilesBySlot.get(slotId);
    if (!profile) {
      return {
        profilesConfigured,
        profilesComplete: true,
        manual: true,
        compatible: false,
        error: `${slotId}는 메인보드에 등록된 M.2 슬롯이 아닙니다.`
      };
    }
    const units = unitsByPart.get(rawPartId.trim());
    const unit = units?.shift();
    if (!unit) {
      return {
        profilesConfigured,
        profilesComplete: true,
        manual: true,
        compatible: false,
        error: `${rawPartId}는 현재 선택한 M.2 SSD가 아니거나 수량을 초과해 지정되었습니다.`
      };
    }
    assignments.push(m2SlotAssignmentFrom(unit, profile));
  }
  const sortedAssignments = assignments.sort((left, right) => left.slotId.localeCompare(right.slotId));
  return {
    profilesConfigured,
    profilesComplete: true,
    manual: true,
    assignments: sortedAssignments,
    compatible: sortedAssignments.every((assignment) => {
      const profile = profilesBySlot.get(assignment.slotId);
      const part = ssds.find(({ part }) => part.id === assignment.partId)?.part;
      return Boolean(profile && part && m2SlotProfileCanAccept(part, profile));
    })
  };
}

function buildMetrics(
  build: BuildSelection,
  cpu: Part | undefined,
  cooler: Part | undefined,
  motherboard: Part | undefined,
  gpu: Part | undefined,
  computerCase: Part | undefined,
  psu: Part | undefined,
  memory: SelectionWithPart[],
  ssds: SelectionWithPart[],
  hdds: SelectionWithPart[],
  m2SlotAssignments?: M2SlotAssignment[],
  m2SlotAssignmentMode?: BuildMetrics["m2SlotAssignmentMode"]
): BuildMetrics {
  const allMemoryCapacityKnown = memory.every(({ part }) => part.specs.capacityGb !== undefined);
  const allSsdFormFactorsKnown = ssds.every(({ part }) => part.specs.formFactor !== undefined);
  const allSataInterfacesKnown = [...ssds, ...hdds].every(({ part }) => part.specs.interface !== undefined);
  const totalMemoryGb = allMemoryCapacityKnown
    ? memory.reduce((total, { selection, part }) => total + (part.specs.capacityGb ?? 0) * selection.quantity, 0)
    : undefined;
  const memorySlotsUsed = physicalMemoryModuleCount(memory);
  const m2Used = allSsdFormFactorsKnown
    ? ssds.reduce((total, { selection, part }) => total + (part.specs.formFactor?.toLocaleLowerCase().includes("m.2") ? selection.quantity : 0), 0)
    : undefined;
  const sataUsed = allSataInterfacesKnown
    ? [...ssds, ...hdds].reduce((total, { selection, part }) => total + (part.specs.interface?.toLocaleLowerCase().includes("sata") ? selection.quantity : 0), 0)
    : undefined;
  const hddUsed = hdds.reduce((total, { selection }) => total + selection.quantity, 0);
  const cpuPowerW = cpu?.specs.pptW ?? cpu?.specs.tdpW;
  const gpuPowerW = gpu?.specs.powerW;
  const recommendedPsuW = gpu?.specs.recommendedPsuW;
  const psuWattageW = psu?.specs.wattageW;
  const powerHeadroomW = psuWattageW !== undefined && recommendedPsuW !== undefined
    ? psuWattageW - recommendedPsuW
    : undefined;
  const memoryHeadroomGb = totalMemoryGb !== undefined && motherboard?.specs.maxMemoryGb !== undefined
    ? motherboard.specs.maxMemoryGb - totalMemoryGb
    : undefined;
  const memorySlotHeadroom = motherboard?.specs.memorySlots !== undefined && memory.length > 0
    ? motherboard.specs.memorySlots - memorySlotsUsed
    : undefined;
  const m2Headroom = m2Used !== undefined && motherboard?.specs.m2Slots !== undefined
    ? motherboard.specs.m2Slots - m2Used
    : undefined;
  const sataHeadroom = sataUsed !== undefined && motherboard?.specs.sataPorts !== undefined
    ? motherboard.specs.sataPorts - sataUsed
    : undefined;
  const hddBayHeadroom = hdds.length > 0 && computerCase?.specs.hddBays !== undefined
    ? computerCase.specs.hddBays - hddUsed
    : undefined;
  const coolerCapacityW = cooler?.specs.maxCoolingW;
  const coolerHeadroomW = cpuPowerW !== undefined && coolerCapacityW !== undefined
    ? coolerCapacityW - cpuPowerW
    : undefined;
  const gpuClearanceMm = gpu?.specs.lengthMm !== undefined && computerCase?.specs.maxGpuLengthMm !== undefined
    ? computerCase.specs.maxGpuLengthMm - gpu.specs.lengthMm
    : undefined;
  const coolerClearanceMm = cooler?.specs.maxCoolerHeightMm !== undefined && computerCase?.specs.maxCoolerHeightMm !== undefined
    ? computerCase.specs.maxCoolerHeightMm - cooler.specs.maxCoolerHeightMm
    : undefined;
  const psuClearanceMm = psu?.specs.psuDepthMm !== undefined && computerCase?.specs.maxPsuLengthMm !== undefined
    ? computerCase.specs.maxPsuLengthMm - psu.specs.psuDepthMm
    : undefined;
  return {
    totalMemoryGb,
    memoryHeadroomGb,
    memorySlotsUsed: memory.length > 0 ? memorySlotsUsed : undefined,
    memorySlotsTotal: motherboard?.specs.memorySlots,
    memorySlotHeadroom,
    m2Used,
    m2SlotsTotal: motherboard?.specs.m2Slots,
    m2Headroom,
    sataUsed,
    sataPortsTotal: motherboard?.specs.sataPorts,
    sataHeadroom,
    hddUsed: hdds.length > 0 ? hddUsed : undefined,
    hddBaysTotal: computerCase?.specs.hddBays,
    hddBayHeadroom,
    cpuPowerW,
    gpuPowerW,
    recommendedPsuW,
    psuWattageW,
    powerHeadroomW,
    coolerCapacityW,
    coolerHeadroomW,
    gpuLengthMm: gpu?.specs.lengthMm,
    gpuThicknessMm: gpu?.specs.thicknessMm,
    maxGpuLengthMm: computerCase?.specs.maxGpuLengthMm,
    psuDepthMm: psu?.specs.psuDepthMm,
    maxPsuLengthMm: computerCase?.specs.maxPsuLengthMm,
    psuClearanceMm,
    gpuClearanceMm,
    coolerHeightMm: cooler?.specs.maxCoolerHeightMm,
    maxCoolerHeightMm: computerCase?.specs.maxCoolerHeightMm,
    coolerClearanceMm,
    ...(m2SlotAssignments && m2SlotAssignments.length > 0
      ? {
          m2SlotAssignments,
          ...(m2SlotAssignmentMode ? { m2SlotAssignmentMode } : {})
        }
      : {})
  };
}

function currentCategoryPart(catalog: Part[], build: BuildSelection, category: PartCategory) {
  const selection = category === "memory" ? build.memory[0] : category === "ssd" ? build.ssd[0] : category === "hdd" ? build.hdd[0] : build[category];
  return selectedPart(catalog, selection);
}

function categorySelections(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function setSingleSelectionQuantity(build: BuildSelection, category: PartCategory, quantity: number): BuildSelection | undefined {
  const selections = categorySelections(build, category);
  if (selections.length !== 1 || quantity < 1 || !Number.isInteger(quantity)) return undefined;
  const next = cloneBuild(build);
  if (category === "memory" || category === "ssd" || category === "hdd") {
    next[category] = [{ ...selections[0], quantity }];
  } else {
    next[category] = { ...selections[0], quantity };
  }
  if (category === "ssd") delete next.m2SlotSelection;
  return next;
}

function selectedCorePartIds(build: BuildSelection) {
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

export type AlternativeAssessment = {
  risk: AlternativeRisk;
  reasons: string[];
  recommendedQuantity?: number;
  fixesCurrentIssue?: boolean;
  candidateBlockerCount: number;
  candidateWarningCount: number;
  candidateUnknownCount: number;
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  physicalEvidence?: PhysicalEvidenceSummary;
};

export function assessAlternativePart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part, intentFinding?: Finding): AlternativeAssessment {
  const intentDetails = (fixesCurrentIssue: boolean) => intentFinding ? { fixesCurrentIssue } : {};
  if (candidate.category !== category) return { risk: "unsafe", reasons: ["부품 카테고리가 다릅니다."], candidateBlockerCount: 1, candidateWarningCount: 0, candidateUnknownCount: 0, remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0, ...intentDetails(false) };
  if (candidate.dataQuality === "incomplete") return { risk: "unsafe", reasons: ["필수 스펙이 부족합니다."], candidateBlockerCount: 1, candidateWarningCount: 0, candidateUnknownCount: 0, remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0, ...intentDetails(false) };
  if (selectedCorePartIds(build).has(candidate.id)) return { risk: "unsafe", reasons: ["이미 선택된 부품입니다."], candidateBlockerCount: 1, candidateWarningCount: 0, candidateUnknownCount: 0, remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0, ...intentDetails(false) };
  const recommendedQuantity = category === "memory" && build.memory.length > 1
    ? recommendedMemoryKitQuantity(build, catalog, candidate)
    : undefined;
  if (category === "memory" && build.memory.length > 1 && recommendedQuantity === undefined) {
    return { risk: "review", reasons: ["혼용 RAM 전체 용량과 슬롯을 보존할 추천 킷 수량을 계산할 수 없습니다."], candidateBlockerCount: 0, candidateWarningCount: 0, candidateUnknownCount: 1, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 1, ...intentDetails(false) };
  }
  const motherboard = selectedPart(catalog, build.motherboard);
  const motherboardM2PcieGenerations = motherboard?.specs.m2PcieGenerations;
  const motherboardMaxM2PcieGeneration = motherboardM2PcieGenerations && motherboardM2PcieGenerations.length > 0
    ? Math.max(...motherboardM2PcieGenerations)
    : undefined;
  if (category === "ssd"
    && candidate.specs.interface === "NVMe"
    && candidate.specs.formFactor?.toLowerCase().includes("m.2")
    && motherboardMaxM2PcieGeneration !== undefined
    && candidate.specs.m2PcieGeneration === undefined) {
    return {
      risk: "review",
      reasons: ["후보 NVMe M.2 SSD의 PCIe 세대가 확인되지 않습니다."],
      recommendedQuantity,
      candidateBlockerCount: 0,
      candidateWarningCount: 0,
      candidateUnknownCount: 1,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 1,
      ...intentDetails(false)
    };
  }
  const evaluation = evaluateBuild(replaceSelection(build, category, candidate.id, recommendedQuantity), catalog, { includeSuggestions: false });
  const intentEligible = intentFinding === undefined || candidateIsPlausible(intentFinding, build, candidate, catalog, category);
  const fixesCurrentIssue = intentFinding === undefined
    ? undefined
    : intentEligible && !evaluation.findings.some((item) => item.ruleId === intentFinding.ruleId);
  const candidateFindings = evaluation.findings.filter((finding) => finding.affectedPartIds.includes(candidate.id));
  const reasons = [...new Set(candidateFindings
    .filter((finding) => finding.severity === "blocker" || finding.severity === "unknown")
    .map((finding) => finding.title))];
  const candidateBlockerCount = candidateFindings.filter((finding) => finding.severity === "blocker").length;
  const candidateWarningCount = candidateFindings.filter((finding) => finding.severity === "warning").length;
  const candidateUnknownCount = candidateFindings.filter((finding) => finding.severity === "unknown").length;
  const physicalEvidence = physicalEvidenceSummaryFor(category, evaluation);
  const physicalEvidenceDetails = physicalEvidence ? { physicalEvidence } : {};
  if (candidateBlockerCount > 0) return { risk: "unsafe", reasons, recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
  if (candidateUnknownCount > 0) return { risk: "review", reasons, recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
  return { risk: "safe", reasons: [], recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
}

export function alternativeRiskForPart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part): AlternativeRisk {
  return assessAlternativePart(build, catalog, category, candidate).risk;
}

export function isSafeAlternativePart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part) {
  return alternativeRiskForPart(build, catalog, category, candidate) === "safe";
}

function physicalEvidenceSummaryFor(targetCategory: PartCategory, evaluation: CompatibilityResult): PhysicalEvidenceSummary | undefined {
  if (targetCategory !== "gpu" && targetCategory !== "case" && targetCategory !== "psu") return undefined;
  if (!evaluation.gpuFit) return undefined;
  const evidence = gpuPurchaseEvidenceFor(evaluation.gpuFit);
  const sources = evidence.sources && evidence.sources.length > 0 ? { sources: evidence.sources } : {};
  if (evidence.status === "not_applicable") return { status: "not_applicable", summary: "현재 구성에서는 GPU 물리·PCIe 케이블 근거 검수가 적용되지 않습니다.", ...sources };
  if (evidence.status === "compatible") return { status: "verified", summary: "필요한 GPU·케이스 물리와 PCIe 케이블 근거가 확인되었습니다.", ...sources };
  const missing: string[] = [];
  if (evidence.sources?.some((source) => physicalSourceCheckNeedsReview(source.sourceCheck, Boolean(source.url)))) missing.push("근거 URL·모델 식별");
  if (evidence.physical === "needs_review") missing.push("GPU·케이스 물리 근거");
  if (evidence.pcieCableTopology === "needs_review") missing.push("다중 8핀 케이블 토폴로지 근거");
  return { status: "review", summary: `${missing.join(" · ") || "물리 근거"}를 구매 전 확인해야 합니다.`, ...sources };
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

function candidateIsPlausible(finding: Finding, build: BuildSelection, candidate: Part, catalog: Part[], targetCategoryOverride?: PartCategory) {
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
    if (targetCategory === "motherboard" && cpu?.specs.socket && candidate.specs.socket) return candidate.specs.socket === cpu.specs.socket;
    if (targetCategory === "cpu" && motherboard?.specs.socket && candidate.specs.socket) return candidate.specs.socket === motherboard.specs.socket;
  }
  if (finding.ruleId === "cpu-motherboard-power") {
    if (targetCategory === "motherboard" && cpu?.specs.pptW && candidate.specs.vrmCapacityW) return candidate.specs.vrmCapacityW >= cpu.specs.pptW;
  }
  if (finding.ruleId === "memory-type") {
    const expected = targetCategory === "motherboard" ? cpu?.specs.memoryType : motherboard?.specs.memoryType;
    if (expected && candidate.specs.memoryType) return candidate.specs.memoryType === expected;
  }
  if (finding.ruleId === "memory-profile") {
    const selectedProfiles = [...new Set(memory.flatMap(({ part }) => part.specs.memoryProfiles ?? []))];
    if (targetCategory === "motherboard" && selectedProfiles.length > 0 && candidate.specs.memoryProfiles) {
      return selectedProfiles.every((profile) => candidate.specs.memoryProfiles!.includes(profile));
    }
    if (targetCategory === "memory" && motherboard?.specs.memoryProfiles && candidate.specs.memoryProfiles) {
      return candidate.specs.memoryProfiles.some((profile) => motherboard.specs.memoryProfiles!.includes(profile));
    }
  }
  if (finding.ruleId === "memory-mixing" && targetCategory === "memory") {
    return recommendedMemoryKitQuantity(build, catalog, candidate) !== undefined;
  }
  if (finding.ruleId === "memory-form-factor") {
    if (targetCategory === "motherboard" && memoryFormFactors.length === 1 && candidate.specs.memoryFormFactor) return candidate.specs.memoryFormFactor === memoryFormFactors[0];
    if (targetCategory === "memory" && motherboard?.specs.memoryFormFactor && candidate.specs.formFactor) return candidate.specs.formFactor === motherboard.specs.memoryFormFactor;
  }
  if (finding.ruleId === "memory-capacity" && targetCategory === "motherboard" && totalMemoryGb !== undefined && candidate.specs.maxMemoryGb !== undefined) return candidate.specs.maxMemoryGb >= totalMemoryGb;
  if (finding.ruleId === "memory-slots" && targetCategory === "motherboard" && candidate.specs.memorySlots !== undefined) return candidate.specs.memorySlots >= memoryCount;
  if (finding.ruleId === "m2-slots" && targetCategory === "motherboard" && m2Count !== undefined && candidate.specs.m2Slots !== undefined) return candidate.specs.m2Slots >= m2Count;
  if (finding.ruleId === "m2-interface") {
    if (targetCategory === "motherboard" && requiredM2Interfaces.length > 0 && candidate.specs.m2Interfaces) {
      return requiredM2Interfaces.every((interfaceName) => candidate.specs.m2Interfaces!.includes(interfaceName));
    }
    if (targetCategory === "ssd" && candidate.specs.formFactor?.toLowerCase().includes("m.2") && candidate.specs.interface && motherboard?.specs.m2Interfaces) {
      return motherboard.specs.m2Interfaces.includes(candidate.specs.interface as "NVMe" | "SATA");
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
    if (targetCategory === "motherboard" && requiredGeneration !== undefined && candidate.specs.m2PcieGenerations?.length) {
      return Math.max(...candidate.specs.m2PcieGenerations) >= requiredGeneration;
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
    if (targetCategory === "motherboard" && gpuSlotWidth !== undefined && (gpuSlotWidth === 16 || gpuSlotWidth === 8) && candidate.specs.pcieX16Slots !== undefined) {
      return gpuSlotWidth === 16 ? candidate.specs.pcieX16Slots > 0 : candidate.specs.pcieX16Slots > 0 || (candidate.specs.pcieX8Slots ?? 0) > 0;
    }
    if (targetCategory === "gpu" && motherboard?.specs.pcieX16Slots !== undefined && candidate.specs.pcieSlotWidth !== undefined && (candidate.specs.pcieSlotWidth === 16 || candidate.specs.pcieSlotWidth === 8)) {
      return candidate.specs.pcieSlotWidth === 16 ? motherboard.specs.pcieX16Slots > 0 : motherboard.specs.pcieX16Slots > 0 || (motherboard.specs.pcieX8Slots ?? 0) > 0;
    }
  }
  if (finding.ruleId === "gpu-psu-connector") {
    const gpuPowerOptions = gpu?.specs.pciePowerOptions;
    if (targetCategory === "psu" && gpuPowerOptions && candidate.specs.pciePowerConnectors) {
      return pciePowerMatchFor(gpuPowerOptions, candidate.specs.pciePowerConnectors).status === "compatible";
    }
    if (targetCategory === "gpu" && psu?.specs.pciePowerConnectors && candidate.specs.pciePowerOptions) {
      return pciePowerMatchFor(candidate.specs.pciePowerOptions, psu.specs.pciePowerConnectors).status === "compatible";
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
  if (finding.ruleId === "case-hdd-bays" && targetCategory === "case" && candidate.specs.hddBays !== undefined) return candidate.specs.hddBays >= hddCount;
  if (finding.ruleId === "cpu-cooler-socket" && targetCategory === "cooler" && cpu?.specs.socket && candidate.specs.supportedSockets) return candidate.specs.supportedSockets.includes(cpu.specs.socket);
  if (finding.ruleId === "case-cooler-height" && targetCategory === "case" && cooler?.specs.maxCoolerHeightMm && candidate.specs.maxCoolerHeightMm) return candidate.specs.maxCoolerHeightMm >= cooler.specs.maxCoolerHeightMm;
  if (finding.ruleId === "case-cooler-height" && targetCategory === "cooler" && computerCase?.specs.maxCoolerHeightMm && candidate.specs.maxCoolerHeightMm) return candidate.specs.maxCoolerHeightMm <= computerCase.specs.maxCoolerHeightMm;
  if (finding.ruleId === "gpu-case-length" && targetCategory === "case" && gpu?.specs.lengthMm && candidate.specs.maxGpuLengthMm) return candidate.specs.maxGpuLengthMm >= gpu.specs.lengthMm;
  if (finding.ruleId === "gpu-case-length" && targetCategory === "gpu" && computerCase?.specs.maxGpuLengthMm && candidate.specs.lengthMm) return candidate.specs.lengthMm <= computerCase.specs.maxGpuLengthMm;
  if (finding.ruleId === "psu-case-length" && targetCategory === "case" && psu?.specs.psuDepthMm !== undefined && candidate.specs.maxPsuLengthMm !== undefined) return candidate.specs.maxPsuLengthMm >= psu.specs.psuDepthMm;
  if (finding.ruleId === "psu-case-length" && targetCategory === "psu" && computerCase?.specs.maxPsuLengthMm !== undefined && candidate.specs.psuDepthMm !== undefined) return candidate.specs.psuDepthMm <= computerCase.specs.maxPsuLengthMm;
  if (finding.ruleId === "psu-case-form-factor" && targetCategory === "case" && psu?.specs.psuFormFactor && candidate.specs.supportedPsuFormFactors) return candidate.specs.supportedPsuFormFactors.includes(psu.specs.psuFormFactor);
  if (finding.ruleId === "psu-case-form-factor" && targetCategory === "psu" && computerCase?.specs.supportedPsuFormFactors && candidate.specs.psuFormFactor) return computerCase.specs.supportedPsuFormFactors.includes(candidate.specs.psuFormFactor);
  if (finding.ruleId === "gpu-psu-power" && targetCategory === "psu" && gpu?.specs.recommendedPsuW && candidate.specs.wattageW) return candidate.specs.wattageW >= gpu.specs.recommendedPsuW;
  if (finding.ruleId === "gpu-psu-power" && targetCategory === "gpu" && psu?.specs.wattageW && candidate.specs.recommendedPsuW) return candidate.specs.recommendedPsuW <= psu.specs.wattageW;
  if (finding.ruleId === "case-motherboard-form-factor" && targetCategory === "case" && motherboard?.specs.formFactor && candidate.specs.motherboardFormFactors) return candidate.specs.motherboardFormFactors.includes(motherboard.specs.formFactor);
  return true;
}

export function candidateFixesFinding(finding: Finding, build: BuildSelection, catalog: Part[], targetCategory: PartCategory, candidate: Part) {
  return assessAlternativePart(build, catalog, targetCategory, candidate, finding).fixesCurrentIssue === true;
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

function performanceDimensions(part: Part) {
  if (part.category === "cpu") {
    return {
      cinebenchR23Single: part.specs.cinebenchR23Single,
      cinebenchR23Multi: part.specs.cinebenchR23Multi,
      cores: part.specs.cores,
      threads: part.specs.threads,
      boostClockGhz: part.specs.boostClockGhz
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

function performanceDataCoverageFor(part: Part) {
  return Object.values(performanceDimensions(part)).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).length;
}

function gpuModelFamilyFor(part: Part) {
  if (part.category !== "gpu") return undefined;
  const source = `${part.model ?? ""} ${part.name}`;
  const match = source.match(/\b((?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XT|XTX|GRE))?)/i);
  return match?.[1].replace(/\s+/g, "").toUpperCase();
}

function cpuModelFamilyFor(part: Part) {
  if (part.category !== "cpu") return undefined;
  const source = `${part.model ?? ""} ${part.name}`;
  const vendor = /(?:AMD|라이젠|RYZEN)/i.test(source) ? "AMD" : /(?:INTEL|인텔|코어)/i.test(source) ? "INTEL" : undefined;
  const match = source.match(/\b(?:I[3579]-?)?\d{4,5}[A-Z0-9]{0,5}\b/i);
  return match?.[0] && vendor ? `${vendor}:${match[0].replace(/-/g, "").toUpperCase()}` : undefined;
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
  if (!current || (current.category !== "cpu" && current.category !== "gpu") || performanceDataCoverageFor(current) > 0) return undefined;
  const family = performanceFamilyFor(current);
  if (!family) return undefined;
  const qualityRank: Record<Part["dataQuality"], number> = { manual: 4, live: 3, seed: 2, incomplete: 1 };
  return catalog
    .filter((part) => part.id !== current.id && part.category === current.category && part.dataQuality !== "incomplete" && performanceFamilyFor(part) === family && performanceDataCoverageFor(part) >= 2)
    .sort((left, right) => qualityRank[right.dataQuality] - qualityRank[left.dataQuality]
      || performanceDataCoverageFor(right) - performanceDataCoverageFor(left)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.name.localeCompare(right.name, "ko-KR"))[0];
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
    return `GPU 세대 계열(${current.specs.gpuArchitectureFamily} · ${candidate.specs.gpuArchitectureFamily})이 달라 스트림 프로세서는 유사도에서 제외했습니다.`;
  }
  return undefined;
}

function formatPerformanceEvidenceValue(key: string, value: number) {
  const label = performanceDimensionLabel(key);
  const formatted = formatPerformanceDimension(key, value);
  return formatted.startsWith(`${label} `) ? formatted.slice(label.length + 1) : formatted;
}

const BENCHMARK_DIMENSION_KEYS = new Set(["cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"]);

function similarityBasisForDimensions(dimensions: SimilarityDimensionEvidence[]): SimilarityBasis | undefined {
  const hasBenchmark = dimensions.some((dimension) => BENCHMARK_DIMENSION_KEYS.has(dimension.key));
  const hasSpec = dimensions.some((dimension) => !BENCHMARK_DIMENSION_KEYS.has(dimension.key));
  if (hasBenchmark && hasSpec) return "mixed";
  if (hasBenchmark) return "benchmark";
  if (hasSpec) return "spec";
  return undefined;
}

function similarityBasisForEvidence(evidence: SimilarityEvidence) {
  return evidence.basis ?? similarityBasisForDimensions(evidence.dimensions ?? []);
}

function performanceChangeText(currentValue: number, candidateValue: number) {
  if (candidateValue === currentValue) return "동일";
  if (currentValue === 0) return "변화율 확인 불가";
  const percentage = ((candidateValue - currentValue) / Math.abs(currentValue)) * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
}

function performanceSummaryFor(current: Part | undefined, candidate: Part, comparisonReference?: Part) {
  const comparisonCurrent = comparisonReference ?? current;
  if (!comparisonCurrent) return "기존 부품 없음 · 호환 조건 우선";
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
    ? comparisons.join(" · ")
    : "비교 가능한 스펙 부족 · 호환 조건 우선";
  const referenceCategoryLabel = comparisonReference?.category === "gpu" ? "GPU" : "CPU";
  return comparisonReference ? `동일 ${referenceCategoryLabel} 모델 계열 참조 기준 · ${summary}` : summary;
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

function similarityFor(
  current: Part | undefined,
  candidate: Part,
  profile: RecommendationProfile = "general",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  comparisonReference?: Part,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
) {
  const comparisonCurrent = comparisonReference ?? current;
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
      weight
    });
  }
  const confidence = totalDimensions === 0 || comparedDimensions === 0
    ? "unknown" as const
    : comparedDimensions === totalDimensions && comparedDimensions >= 2
      ? "high" as const
      : "limited" as const;
  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
  const gpuNote = gpuSimilarityNote(comparisonCurrent, candidate);
  const referenceNote = comparisonReference
    ? `현재 선택 부품의 성능 스펙이 부족해 동일 ${comparisonReference.category === "gpu" ? "GPU" : "CPU"} 모델 계열의 검증된 카탈로그 참조(${comparisonReference.name})를 기준으로 유사도를 계산했습니다.`
    : undefined;
  const notes = [referenceNote, gpuNote].filter((note): note is string => Boolean(note));
  const basis = similarityBasisForDimensions(dimensions);
  return {
    score,
    label: similarityLabelFor(score, confidence),
    evidence: { comparedDimensions, totalDimensions, confidence, ...(basis ? { basis } : {}), dimensions, ...(notes.length > 0 ? { notes } : {}) } satisfies SimilarityEvidence
  };
}

export function candidateSimilarityForBuild(
  build: BuildSelection,
  catalog: Part[],
  category: PartCategory,
  candidate: Part,
  profile: RecommendationProfile = "general",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
) {
  const current = currentCategoryPart(catalog, build, category);
  const comparisonReference = performanceReferenceFor(current, catalog);
  const similarity = similarityFor(current, candidate, profile, gamingResolution, comparisonReference, gamingRefreshRate);
  const value = valueForPrices(current?.priceWon, candidate.priceWon, similarity.score, similarity.evidence);
  return {
    similarityScore: similarity.score,
    similarityLabel: similarity.label,
    similarityEvidence: similarity.evidence,
    performanceSummary: performanceSummaryFor(current, candidate, comparisonReference),
    ...(value ?? {})
  };
}

type UpgradeAssessment = {
  improvementPercent: number;
  improvedDimensions: string[];
  upgradeScore: number;
};

type UpgradeRecommendationLimits = {
  maxPerCategory?: number;
  maxTotal?: number;
};

function upgradeAssessmentFor(current: Part, candidate: Part, profile: RecommendationProfile, gamingResolution: GamingResolution, gamingRefreshRate: GamingRefreshRate): UpgradeAssessment | undefined {
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

function upgradeCompatibilityEvidenceFor(category: PartCategory, evaluation: CompatibilityResult): UpgradeCompatibilityEvidence {
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

function upgradeBudgetEvidenceFor(budgetWon: number, baselinePrice: ReturnType<typeof buildPriceInfo>, evaluation: CompatibilityResult): UpgradeBudgetEvidence {
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

function upgradeExpansionEvidenceFor(baseline: CompatibilityResult, evaluation: CompatibilityResult): UpgradeExpansionEvidence {
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

export function buildUpgradeRecommendations(
  build: BuildSelection,
  catalog: Part[],
  profile: RecommendationProfile = "general",
  listingPolicy: ListingPolicy = "retail_only",
  priority: RecommendationPreferences["priority"] = "balanced",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  budgetWon?: number,
  evaluationCache?: EvaluationCache,
  limits: UpgradeRecommendationLimits = {},
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
): UpgradeRecommendation[] {
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  if (baseline.blockerCount > 0 || baseline.unknownCount > 0) return [];
  const baselinePrice = buildPriceInfo(catalog, build);
  const maxPerCategory = Math.max(1, limits.maxPerCategory ?? 2);
  const maxTotal = Math.max(1, limits.maxTotal ?? 8);
  const categories: PartCategory[] = ["cpu", "gpu", "memory", "ssd", "hdd", "cooler", "psu", "case", "motherboard"];
  const currentPartIds = selectedCorePartIds(build);
  const recommendations: UpgradeRecommendation[] = [];
  for (const category of categories) {
    const selections = categorySelections(build, category);
    if (selections.length !== 1) continue;
    const current = currentCategoryPart(catalog, build, category);
    if (!current || current.dataQuality === "incomplete") continue;
    const quantity = selections[0].quantity;
    const assessedCandidates = catalog
      .filter((candidate) => candidate.category === category && !currentPartIds.has(candidate.id) && candidate.dataQuality !== "incomplete")
      .filter((candidate) => isListingAllowed(candidate, listingPolicy))
      .map((candidate) => ({ candidate, assessment: upgradeAssessmentFor(current, candidate, profile, gamingResolution, gamingRefreshRate) }))
      .filter((entry): entry is { candidate: Part; assessment: UpgradeAssessment } => Boolean(entry.assessment))
      .sort((left, right) => right.assessment.improvementPercent - left.assessment.improvementPercent || right.assessment.upgradeScore - left.assessment.upgradeScore)
      .slice(0, 60);
    for (const { candidate, assessment } of assessedCandidates) {
      const nextBuild = replaceSelection(build, category, candidate.id);
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      const comparisonReference = performanceReferenceFor(current, catalog);
      const similarity = similarityFor(current, candidate, profile, gamingResolution, comparisonReference, gamingRefreshRate);
      const gpuTarget = profile === "gaming" && category === "gpu"
        ? gpuTargetEvidenceFor(current, candidate, gamingResolution, gamingRefreshRate)
        : undefined;
      const budgetEvidence = budgetWon === undefined
        ? undefined
        : upgradeBudgetEvidenceFor(budgetWon, baselinePrice, evaluation);
      const priceDeltaWon = isKnownPrice(current.priceWon) && isKnownPrice(candidate.priceWon)
        ? (candidate.priceWon - current.priceWon) * quantity
        : undefined;
      const candidateDeltaFindings = candidateCompatibilityDeltaFindings(baseline, evaluation, candidate.id);
      const recommendationTrust = recommendationTrustFor({
        candidate,
        similarityEvidence: similarity.evidence,
        resolvesTarget: true,
        benchmarkSourceKind: candidate.specs.benchmarkProvenance?.sourceKind,
        candidateBlockers: candidateDeltaFindings.filter((item) => item.severity === "blocker").length,
        candidateWarnings: candidateDeltaFindings.filter((item) => item.severity === "warning").length,
        candidateUnknown: candidateDeltaFindings.filter((item) => item.severity === "unknown").length,
        remainingBlockers: evaluation.blockerCount,
        remainingWarnings: evaluation.warningCount,
        remainingUnknown: evaluation.unknownCount
      });
      const expansionEvidence = upgradeExpansionEvidenceFor(baseline, evaluation);
      const physicalEvidence = physicalEvidenceSummaryFor(category, evaluation);
      recommendations.push({
        category,
        currentPartId: current.id,
        currentPartName: current.name,
        quantity,
        part: candidate,
        upgradeScore: assessment.upgradeScore,
        improvementPercent: assessment.improvementPercent,
        improvedDimensions: assessment.improvedDimensions,
        performanceSummary: performanceSummaryFor(current, candidate, comparisonReference),
        similarityScore: similarity.score,
        similarityLabel: similarity.label,
        similarityEvidence: similarity.evidence,
        ...(isKnownPrice(current.priceWon) ? { currentPriceWon: current.priceWon } : {}),
        ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}),
        ...(gpuTarget ? { gpuTarget } : {}),
        compatibilityEvidence: upgradeCompatibilityEvidenceFor(category, evaluation),
        expansionEvidence,
        ...(budgetEvidence ? { budgetEvidence } : {}),
        recommendationTrust,
        ...(physicalEvidence ? { physicalEvidence } : {}),
        reason: `${assessment.improvedDimensions.join("·")} 기준 비교 가능한 스펙이 약 ${assessment.improvementPercent}% 개선됩니다.${gpuTarget ? ` ${gpuTarget.summary}.` : ""} 교체 후 새로운 차단 오류·확인 필요·주의 항목이 없어 현재 호환 수준을 유지합니다.`
      });
    }
  }
  const rankedRecommendations = recommendations
    .sort((left, right) => {
      const priorityComparison = priority === "performance"
        ? right.improvementPercent - left.improvementPercent
        : priority === "budget"
          ? Number(right.budgetEvidence?.withinBudget === true) - Number(left.budgetEvidence?.withinBudget === true)
            || (left.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER) - (right.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER)
            || (left.priceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.priceDeltaWon ?? Number.MAX_SAFE_INTEGER)
          : right.upgradeScore - left.upgradeScore;
      const targetFitRank = (fit: GpuTargetFit | undefined) => fit === "met" ? 0 : fit === "partial" ? 1 : 2;
      const targetFitComparison = left.gpuTarget && right.gpuTarget
        ? targetFitRank(left.gpuTarget.candidateFit) - targetFitRank(right.gpuTarget.candidateFit)
        : 0;
      return priorityComparison
        || targetFitComparison
        || compareRecommendationTrust(left.recommendationTrust, right.recommendationTrust)
        || compareCandidateSimilarity(left, right)
        || (left.priceDeltaWon ?? 0) - (right.priceDeltaWon ?? 0);
    });
  const categoryCounts = new Map<PartCategory, number>();
  return rankedRecommendations
    .filter((recommendation) => {
      const count = categoryCounts.get(recommendation.category) ?? 0;
      if (count >= maxPerCategory) return false;
      categoryCounts.set(recommendation.category, count + 1);
      return true;
    })
    .slice(0, maxTotal);
}

export type UpgradeBundleSearchResult = {
  bundles: UpgradeBundleRecommendation[];
  summary: UpgradeBundleSearchSummary;
};

function emptyUpgradeBundleSearchResult(recommendations: UpgradeRecommendation[]): UpgradeBundleSearchResult {
  return {
    bundles: [],
    summary: {
      candidateCount: recommendations.length,
      candidateCategoryCount: new Set(recommendations.map((recommendation) => recommendation.category)).size,
      candidatePairCount: 0,
      evaluatedPairCount: 0,
      candidateTripleCount: 0,
      evaluatedTripleCount: 0,
      beamWidth: BUNDLE_BEAM_WIDTH,
      safeBundleCount: 0,
      returnedBundleCount: 0
    }
  };
}

type UpgradeBundleSortMode = "recommended" | "performance" | "budget" | "expansion" | "saving";

function upgradeBundleSortComparisonFor(left: UpgradeBundleRecommendation, right: UpgradeBundleRecommendation, mode: UpgradeBundleSortMode) {
  const priorityComparison = mode === "performance"
    ? right.totalImprovementPercent - left.totalImprovementPercent
    : mode === "budget"
      ? Number(right.budgetEvidence?.withinBudget === true) - Number(left.budgetEvidence?.withinBudget === true)
        || (left.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER) - (right.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER)
        || (left.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER)
      : mode === "expansion"
        ? (right.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY) - (left.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY)
          || (right.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY) - (left.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY)
        : mode === "saving"
          ? (left.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER)
          : right.totalUpgradeScore - left.totalUpgradeScore;
  return priorityComparison
    || right.totalImprovementPercent - left.totalImprovementPercent
    || (left.totalPriceDeltaWon ?? 0) - (right.totalPriceDeltaWon ?? 0)
    || upgradeBundleKeyFor(left).localeCompare(upgradeBundleKeyFor(right));
}

function upgradeBundleSortModeForPriority(priority: RecommendationPreferences["priority"]): UpgradeBundleSortMode {
  return priority === "performance" ? "performance" : priority === "budget" ? "budget" : "recommended";
}

function upgradeBundleKeyFor(bundle: UpgradeBundleRecommendation) {
  return bundle.changes.map((change) => `${change.category}:${change.part.id}`).sort().join("|");
}

export function buildUpgradeBundlesWithSummary(
  build: BuildSelection,
  catalog: Part[],
  recommendations: UpgradeRecommendation[],
  priority: RecommendationPreferences["priority"] = "balanced",
  budgetWon?: number,
  evaluationCache?: EvaluationCache
): UpgradeBundleSearchResult {
  if (recommendations.length < 2) return emptyUpgradeBundleSearchResult(recommendations);
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  if (baseline.blockerCount > 0 || baseline.unknownCount > 0) return emptyUpgradeBundleSearchResult(recommendations);
  const baselinePrice = buildPriceInfo(catalog, build);
  const safePairBundles: UpgradeBundleRecommendation[] = [];
  let candidatePairCount = 0;
  let evaluatedPairCount = 0;
  let candidateTripleCount = 0;
  let evaluatedTripleCount = 0;

  function bundleFor(changes: UpgradeRecommendation[], evaluation: CompatibilityResult): UpgradeBundleRecommendation {
    const totalPriceDeltaWon = changes.every((recommendation) => recommendation.priceDeltaWon !== undefined)
      ? changes.reduce((total, recommendation) => total + (recommendation.priceDeltaWon ?? 0), 0)
      : undefined;
    const budgetEvidence = budgetWon === undefined
      ? undefined
      : upgradeBudgetEvidenceFor(budgetWon, baselinePrice, evaluation);
    const expansionEvidence = upgradeExpansionEvidenceFor(baseline, evaluation);
    const totalImprovementPercent = Number(changes.reduce((total, recommendation) => total + recommendation.improvementPercent, 0).toFixed(1));
    return {
      changes,
      totalUpgradeScore: changes.reduce((total, recommendation) => total + recommendation.upgradeScore, 0),
      totalImprovementPercent,
      ...(totalPriceDeltaWon !== undefined ? { totalPriceDeltaWon } : {}),
      expansionEvidence,
      ...(budgetEvidence ? { budgetEvidence } : {}),
      compatibilityEvidence: {
        blockerCount: evaluation.blockerCount,
        warningCount: evaluation.warningCount,
        unknownCount: evaluation.unknownCount
      },
      reason: `${changes.map((recommendation) => CATEGORY_LABELS[recommendation.category]).join("·")}를 함께 바꾸는 조합입니다. 후보별 비교 변화가 합산 ${totalImprovementPercent}%이며, ${changes.length}개 부품을 함께 적용한 최종 구성도 현재 호환 수준을 유지합니다.`
    };
  }

  for (let leftIndex = 0; leftIndex < recommendations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < recommendations.length; rightIndex += 1) {
      const changes = [recommendations[leftIndex], recommendations[rightIndex]];
      if (changes[0].category === changes[1].category) continue;
      candidatePairCount += 1;
      const nextBuild = changes.reduce(
        (current, recommendation) => replaceSelection(current, recommendation.category, recommendation.part.id),
        build
      );
      evaluatedPairCount += 1;
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      safePairBundles.push(bundleFor(changes, evaluation));
    }
  }

  const primaryBeamMode = upgradeBundleSortModeForPriority(priority);
  const beamModes: UpgradeBundleSortMode[] = primaryBeamMode === "performance"
    ? ["performance", "expansion", "recommended"]
    : primaryBeamMode === "budget"
      ? ["budget", "saving", "expansion"]
      : ["recommended", "expansion", "performance"];
  const beamPairLimitPerMode = Math.max(1, Math.ceil(BUNDLE_BEAM_WIDTH / beamModes.length));
  const beamPairMap = new Map<string, UpgradeBundleRecommendation>();
  for (const mode of beamModes) {
    [...safePairBundles]
      .sort((left, right) => upgradeBundleSortComparisonFor(left, right, mode))
      .slice(0, beamPairLimitPerMode)
      .forEach((bundle) => beamPairMap.set(upgradeBundleKeyFor(bundle), bundle));
  }
  const beamPairs = [...beamPairMap.values()].slice(0, BUNDLE_BEAM_WIDTH);
  const safeTripleBundles: UpgradeBundleRecommendation[] = [];
  const tripleKeys = new Set<string>();
  for (const pair of beamPairs) {
    for (const recommendation of recommendations) {
      if (pair.changes.some((change) => change.category === recommendation.category)) continue;
      const changes = [...pair.changes, recommendation];
      const key = changes.map((change) => `${change.category}:${change.part.id}`).sort().join("|");
      if (tripleKeys.has(key)) continue;
      tripleKeys.add(key);
      candidateTripleCount += 1;
      const nextBuild = changes.reduce(
        (current, change) => replaceSelection(current, change.category, change.part.id),
        build
      );
      evaluatedTripleCount += 1;
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      safeTripleBundles.push(bundleFor(changes, evaluation));
    }
  }

  const safeBundles = [...safePairBundles, ...safeTripleBundles];
  const returnedBundles = [...safeBundles]
    .sort((left, right) => upgradeBundleSortComparisonFor(left, right, primaryBeamMode));
  return {
    bundles: returnedBundles,
    summary: {
      candidateCount: recommendations.length,
      candidateCategoryCount: new Set(recommendations.map((recommendation) => recommendation.category)).size,
      candidatePairCount,
      evaluatedPairCount,
      candidateTripleCount,
      evaluatedTripleCount,
      beamWidth: BUNDLE_BEAM_WIDTH,
      safeBundleCount: safeBundles.length,
      returnedBundleCount: returnedBundles.length
    }
  };
}

export function buildUpgradeBundles(
  build: BuildSelection,
  catalog: Part[],
  recommendations: UpgradeRecommendation[],
  priority: RecommendationPreferences["priority"] = "balanced",
  budgetWon?: number,
  evaluationCache?: EvaluationCache
): UpgradeBundleRecommendation[] {
  return buildUpgradeBundlesWithSummary(build, catalog, recommendations, priority, budgetWon, evaluationCache).bundles;
}

function similarityScoreForSort(candidate: { similarityScore: number; similarityEvidence?: SimilarityEvidence }) {
  const evidence = candidate.similarityEvidence;
  if (!evidence || evidence.totalDimensions <= 0 || evidence.comparedDimensions <= 0) return 0;
  return candidate.similarityScore * (evidence.comparedDimensions / evidence.totalDimensions);
}

export function compareCandidateSimilarity(
  left: { similarityScore: number; similarityEvidence: SimilarityEvidence },
  right: { similarityScore: number; similarityEvidence: SimilarityEvidence }
) {
  const confidenceRank: Record<SimilarityConfidence, number> = { high: 0, limited: 1, unknown: 2 };
  const leftCoverage = left.similarityEvidence.totalDimensions > 0
    ? left.similarityEvidence.comparedDimensions / left.similarityEvidence.totalDimensions
    : 0;
  const rightCoverage = right.similarityEvidence.totalDimensions > 0
    ? right.similarityEvidence.comparedDimensions / right.similarityEvidence.totalDimensions
    : 0;
  return similarityScoreForSort(right) - similarityScoreForSort(left)
    || confidenceRank[left.similarityEvidence.confidence] - confidenceRank[right.similarityEvidence.confidence]
    || rightCoverage - leftCoverage
    || right.similarityEvidence.comparedDimensions - left.similarityEvidence.comparedDimensions;
}

export function compareCandidateValue(
  left: { valueScore?: number; similarityScore: number; similarityEvidence: SimilarityEvidence },
  right: { valueScore?: number; similarityScore: number; similarityEvidence: SimilarityEvidence }
) {
  if (left.valueScore === undefined && right.valueScore !== undefined) return 1;
  if (left.valueScore !== undefined && right.valueScore === undefined) return -1;
  return (right.valueScore ?? 0) - (left.valueScore ?? 0)
    || compareCandidateSimilarity(left, right);
}

function candidateSuggestions(
  finding: Finding,
  build: BuildSelection,
  catalog: Part[],
  limit = 3,
  profile: RecommendationProfile = "general",
  listingPolicy: ListingPolicy = "retail_only",
  priority: RecommendationPreferences["priority"] = "balanced",
  targetCategoryOverride?: PartCategory,
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE,
  evaluationCache?: EvaluationCache,
  searchContext?: RecommendationSearchContext
): Suggestion[] {
  const targetCategory = targetCategoryOverride ?? finding.actions.find((item) => item.type === "replace_part")?.targetCategory;
  if (!targetCategory) return [];

  const allSelections = [build.cpu, build.cooler, build.motherboard, build.gpu, build.case, build.psu]
    .filter((selection): selection is PartSelection => Boolean(selection))
    .concat(build.memory, build.ssd, build.hdd);
  const currentPartIds = new Set(allSelections.map((selection) => selection.partId));

  const currentTarget = catalog.find((part) => part.category === targetCategory && finding.affectedPartIds.includes(part.id))
    ?? currentCategoryPart(catalog, build, targetCategory);
  const currentMemoryPriceTotal = finding.ruleId === "memory-mixing"
    ? selectedParts(catalog, build.memory).every(({ part }) => isKnownPrice(part.priceWon))
      ? selectedParts(catalog, build.memory).reduce((total, { selection, part }) => total + (part.priceWon ?? 0) * selection.quantity, 0)
      : undefined
    : undefined;
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  const comparisonReference = performanceReferenceFor(currentTarget, catalog);
  const candidates = catalog
    .filter((part) => part.category === targetCategory && !currentPartIds.has(part.id))
    .filter((part) => part.dataQuality !== "incomplete")
    .filter((part) => isListingAllowed(part, listingPolicy))
    .filter((part) => candidateIsPlausible(finding, build, part, catalog, targetCategory));
  return candidateEvaluationPoolFor(
    candidates,
    currentTarget,
    comparisonReference,
    profile,
    priority,
    gamingResolution,
    gamingRefreshRate,
    limit,
    searchContext
  ).map(({ part, similarity }) => {
      const recommendedQuantity = finding.ruleId === "memory-mixing"
        ? recommendedMemoryKitQuantity(build, catalog, part)
        : undefined;
      const nextBuild = replaceSelection(build, targetCategory, part.id, recommendedQuantity);
      const evaluation = evaluateBuild(nextBuild, catalog, {
        includeSuggestions: false,
        evaluationCache: cache
      });
      const fixesCurrentIssue = !evaluation.findings.some((item) => item.ruleId === finding.ruleId);
      const score = evaluation.blockerCount * 100 + evaluation.unknownCount * 10 + evaluation.warningCount;
      const fullyCompatible = isFullyCompatible(evaluation.blockerCount, evaluation.warningCount, evaluation.unknownCount);
      const candidateDeltaFindings = candidateCompatibilityDeltaFindings(baseline, evaluation, part.id);
      const candidateBlockerCount = candidateDeltaFindings.filter((item) => item.severity === "blocker").length;
      const candidateWarningCount = candidateDeltaFindings.filter((item) => item.severity === "warning").length;
      const candidateUnknownCount = candidateDeltaFindings.filter((item) => item.severity === "unknown").length;
      const physicalEvidence = physicalEvidenceSummaryFor(targetCategory, evaluation);
      const priceDeltaWon = finding.ruleId === "memory-mixing" && recommendedQuantity !== undefined
        ? isKnownPrice(part.priceWon) && currentMemoryPriceTotal !== undefined
          ? part.priceWon * recommendedQuantity - currentMemoryPriceTotal
          : undefined
        : isKnownPrice(currentTarget?.priceWon) && isKnownPrice(part.priceWon)
          ? part.priceWon - currentTarget.priceWon
          : undefined;
      const currentPriceWon = finding.ruleId === "memory-mixing" ? currentMemoryPriceTotal : currentTarget?.priceWon;
      const candidatePriceWon = recommendedQuantity !== undefined && isKnownPrice(part.priceWon)
        ? part.priceWon * recommendedQuantity
        : part.priceWon;
      const value = valueForPrices(currentPriceWon, candidatePriceWon, similarity.score, similarity.evidence);
      const recommendationTrust = recommendationTrustFor({
        candidate: part,
        similarityEvidence: similarity.evidence,
        resolvesTarget: fixesCurrentIssue,
        benchmarkSourceKind: part.specs.benchmarkProvenance?.sourceKind,
        candidateBlockers: candidateBlockerCount,
        candidateWarnings: candidateWarningCount,
        candidateUnknown: candidateUnknownCount,
        remainingBlockers: evaluation.blockerCount,
        remainingWarnings: evaluation.warningCount,
        remainingUnknown: evaluation.unknownCount
      });
      return {
        suggestion: {
          part,
          ...(recommendedQuantity !== undefined ? { recommendedQuantity } : {}),
          ...(currentPriceWon !== undefined ? { currentPriceWon } : {}),
          score,
          reason: fullyCompatible
            ? "이 후보로 교체하면 전체 구성도 호환됩니다."
            : `이 호환 문제를 해결합니다. ${remainingIssueSummary(evaluation.blockerCount, evaluation.warningCount, evaluation.unknownCount)}는 별도로 남습니다.`,
          remainingBlockers: evaluation.blockerCount,
          remainingWarnings: evaluation.warningCount,
          remainingUnknown: evaluation.unknownCount,
          priceDeltaWon,
          fixesCurrentIssue,
          similarityScore: similarity.score,
          similarityLabel: similarity.label,
          similarityEvidence: similarity.evidence,
          performanceSummary: performanceSummaryFor(currentTarget, part, comparisonReference),
          profileSummary: profileSummaryFor(profile),
          recommendationTrust,
          ...(physicalEvidence ? { physicalEvidence } : {}),
          ...(value ?? {})
        },
        introducesNewCompatibilityRisk: candidateBlockerCount > 0 || candidateUnknownCount > 0
      };
    })
    .filter(({ suggestion, introducesNewCompatibilityRisk }) => suggestion.fixesCurrentIssue && !introducesNewCompatibilityRisk)
    .map(({ suggestion }) => suggestion)
    .sort((a, b) => {
      const aFullyCompatible = a.remainingBlockers === 0 && a.remainingWarnings === 0 && a.remainingUnknown === 0;
      const bFullyCompatible = b.remainingBlockers === 0 && b.remainingWarnings === 0 && b.remainingUnknown === 0;
      const priorityComparison = priority === "budget"
        ? (a.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.part.priceWon ?? Number.MAX_SAFE_INTEGER)
        : priority === "performance"
          ? compareCandidateSimilarity(a, b)
          : 0;
      return Number(bFullyCompatible) - Number(aFullyCompatible)
        || a.score - b.score
        || (priority === "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || priorityComparison
        || (priority !== "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || compareCandidateSimilarity(a, b)
        || Math.abs(a.priceDeltaWon ?? 0) - Math.abs(b.priceDeltaWon ?? 0)
        || (a.part.priceWon ?? 0) - (b.part.priceWon ?? 0);
    })
    .slice(0, limit);
}

type PlanOption = {
  category: PartCategory;
  suggestion: Suggestion;
  kind: "replace_part" | "change_quantity";
  fromQuantity?: number;
  toQuantity?: number;
};

type CandidateEvaluationPoolEntry = {
  part: Part;
  similarity: ReturnType<typeof similarityFor>;
};

function candidateEvaluationPoolFor(
  candidates: Part[],
  currentTarget: Part | undefined,
  comparisonReference: Part | undefined,
  profile: RecommendationProfile,
  priority: RecommendationPreferences["priority"],
  gamingResolution: GamingResolution,
  gamingRefreshRate: GamingRefreshRate,
  limit: number,
  searchContext?: RecommendationSearchContext
): CandidateEvaluationPoolEntry[] {
  const entries = candidates.map((part) => ({
    part,
    similarity: similarityFor(currentTarget, part, profile, gamingResolution, comparisonReference, gamingRefreshRate)
  }));
  const poolSize = Math.max(64, Math.min(CANDIDATE_EVALUATION_POOL_SIZE, limit * 24));
  const recordSearch = (evaluatedCount: number, bounded: boolean) => {
    if (!searchContext) return;
    searchContext.candidateSetCount += 1;
    searchContext.candidateCount += entries.length;
    searchContext.evaluatedCandidateCount += evaluatedCount;
    searchContext.maxEvaluatedCandidatesPerSet = Math.max(searchContext.maxEvaluatedCandidatesPerSet, evaluatedCount);
    if (bounded) searchContext.bounded = true;
  };
  if (entries.length <= poolSize) {
    recordSearch(entries.length, false);
    return entries;
  }

  const similarityRanked = [...entries].sort((left, right) =>
    right.similarity.score - left.similarity.score
    || right.similarity.evidence.comparedDimensions - left.similarity.evidence.comparedDimensions
    || right.similarity.evidence.totalDimensions - left.similarity.evidence.totalDimensions
    || left.part.id.localeCompare(right.part.id)
  );
  const priceRanked = entries
    .filter(({ part }) => isKnownPrice(part.priceWon))
    .sort((left, right) =>
      (left.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (right.part.priceWon ?? Number.MAX_SAFE_INTEGER)
      || right.similarity.score - left.similarity.score
      || left.part.id.localeCompare(right.part.id)
    );
  const priorityRanked = priority === "budget" ? priceRanked : similarityRanked;
  const selected = new Map<string, CandidateEvaluationPoolEntry>();
  const add = (items: CandidateEvaluationPoolEntry[], count: number) => {
    for (const item of items.slice(0, count)) {
      if (!selected.has(item.part.id)) selected.set(item.part.id, item);
    }
  };
  add(priorityRanked, poolSize);
  add(similarityRanked, poolSize);
  add(priceRanked, Math.ceil(poolSize / 2));
  const pool = [...selected.values()];
  recordSearch(pool.length, true);
  return pool;
}

function quantityPlanOptions(
  finding: Finding,
  build: BuildSelection,
  catalog: Part[],
  limit = 3,
  profile: RecommendationProfile = "general",
  evaluationCache?: EvaluationCache
): PlanOption[] {
  const targetCategories = [...new Set(
    finding.actions
      .filter((item) => item.type === "change_quantity" && item.targetCategory)
      .map((item) => item.targetCategory as PartCategory)
  )];
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  const options: PlanOption[] = [];

  for (const category of targetCategories) {
    const selections = categorySelections(build, category);
    const current = currentCategoryPart(catalog, build, category);
    if (!current || selections.length !== 1) continue;
    const fromQuantity = selections[0].quantity;
    let candidateQuantities: number[];
    if (finding.ruleId === "memory-dual-channel") {
      if (category !== "memory") {
        candidateQuantities = [2];
      } else {
        const modulesPerKit = current.specs.memoryModuleCountPerKit ?? 1;
        candidateQuantities = modulesPerKit > 0 && 2 % modulesPerKit === 0 ? [2 / modulesPerKit] : [];
      }
    } else {
      candidateQuantities = Array.from({ length: Math.max(0, fromQuantity - 1) }, (_value, index) => fromQuantity - 1 - index);
    }

    for (const toQuantity of [...new Set(candidateQuantities)]) {
      if (toQuantity < 1 || toQuantity === fromQuantity) continue;
      const nextBuild = setSingleSelectionQuantity(build, category, toQuantity);
      if (!nextBuild) continue;
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      const fixesCurrentIssue = !evaluation.findings.some((item) => item.ruleId === finding.ruleId);
      if (!fixesCurrentIssue) continue;
      const candidateDeltaFindings = candidateCompatibilityDeltaFindings(baseline, evaluation, current.id);
      const priceDeltaWon = !isKnownPrice(current.priceWon)
        ? undefined
        : (toQuantity - fromQuantity) * current.priceWon;
      const fullyCompatible = isFullyCompatible(evaluation.blockerCount, evaluation.warningCount, evaluation.unknownCount);
      const similarityEvidence: SimilarityEvidence = { comparedDimensions: 0, totalDimensions: 0, confidence: "unknown" };
      options.push({
        category,
        kind: "change_quantity",
        fromQuantity,
        toQuantity,
        suggestion: {
          part: current,
          score: evaluation.blockerCount * 100 + evaluation.unknownCount * 10 + evaluation.warningCount,
          reason: fullyCompatible
            ? "수량만 조정하면 전체 구성도 호환됩니다."
            : `수량만 조정해 이 문제를 해결합니다. ${remainingIssueSummary(evaluation.blockerCount, evaluation.warningCount, evaluation.unknownCount)}는 별도로 남습니다.`,
          remainingBlockers: evaluation.blockerCount,
          remainingWarnings: evaluation.warningCount,
          remainingUnknown: evaluation.unknownCount,
          priceDeltaWon,
          fixesCurrentIssue,
          similarityScore: 100,
          similarityLabel: "동급",
          similarityEvidence,
          performanceSummary: `수량 ${fromQuantity}개 → ${toQuantity}개 · 동일 부품 성능 유지`,
          profileSummary: profileSummaryFor(profile),
          recommendationTrust: recommendationTrustFor({
            candidate: current,
            similarityEvidence,
            resolvesTarget: fixesCurrentIssue,
            benchmarkSourceKind: current.specs.benchmarkProvenance?.sourceKind,
            candidateBlockers: candidateDeltaFindings.filter((item) => item.severity === "blocker").length,
            candidateWarnings: candidateDeltaFindings.filter((item) => item.severity === "warning").length,
            candidateUnknown: candidateDeltaFindings.filter((item) => item.severity === "unknown").length,
            remainingBlockers: evaluation.blockerCount,
            remainingWarnings: evaluation.warningCount,
            remainingUnknown: evaluation.unknownCount
          })
        }
      });
    }
  }

  return options
    .sort((a, b) => {
      const aSuggestion = a.suggestion;
      const bSuggestion = b.suggestion;
      const aFullyCompatible = aSuggestion.remainingBlockers === 0 && aSuggestion.remainingWarnings === 0 && aSuggestion.remainingUnknown === 0;
      const bFullyCompatible = bSuggestion.remainingBlockers === 0 && bSuggestion.remainingWarnings === 0 && bSuggestion.remainingUnknown === 0;
      return Number(bFullyCompatible) - Number(aFullyCompatible)
        || aSuggestion.score - bSuggestion.score
        || Math.abs(aSuggestion.priceDeltaWon ?? 0) - Math.abs(bSuggestion.priceDeltaWon ?? 0)
        || (a.toQuantity ?? 0) - (b.toQuantity ?? 0);
    })
    .slice(0, limit);
}

function similarityLabelFor(score: number, confidence: SimilarityConfidence = "high"): "동급" | "유사" | "대안" {
  if (confidence === "unknown") return "대안";
  if (confidence === "limited") return score >= 65 ? "유사" : "대안";
  return score >= 85 ? "동급" : score >= 65 ? "유사" : "대안";
}

function valueLabelFor(score: number): ValueLabel {
  if (score >= 115) return "가성비 우수";
  if (score >= 90) return "가성비 균형";
  return "가격 대비 낮음";
}

function valueForPrices(currentPriceWon: number | undefined, candidatePriceWon: number | undefined, similarityScore: number, similarityEvidence: SimilarityEvidence) {
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

function mergeSimilarityEvidence(evidences: SimilarityEvidence[]) {
  const usable = evidences.filter((evidence) => evidence.totalDimensions > 0);
  if (usable.length === 0) return undefined;
  const comparedDimensions = usable.reduce((total, evidence) => total + evidence.comparedDimensions, 0);
  const totalDimensions = usable.reduce((total, evidence) => total + evidence.totalDimensions, 0);
  const notes = [...new Set(usable.flatMap((evidence) => evidence.notes ?? []))];
  const bases = new Set(usable.map(similarityBasisForEvidence).filter((basis): basis is SimilarityBasis => Boolean(basis)));
  const basis: SimilarityBasis | undefined = bases.has("mixed") || bases.size > 1
    ? "mixed"
    : bases.values().next().value;
  return {
    comparedDimensions,
    totalDimensions,
    confidence: comparedDimensions === totalDimensions && comparedDimensions >= 2 ? "high" as const : comparedDimensions > 0 ? "limited" as const : "unknown" as const,
    ...(basis ? { basis } : {}),
    ...(notes.length > 0 ? { notes } : {})
  } satisfies SimilarityEvidence;
}

function selectedQuantity(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory[0]?.quantity ?? 1;
  if (category === "ssd") return build.ssd[0]?.quantity ?? 1;
  if (category === "hdd") return build.hdd[0]?.quantity ?? 1;
  return build[category]?.quantity ?? 1;
}

function buildRepairPlans(
  result: CompatibilityResult,
  build: BuildSelection,
  catalog: Part[],
  preferences?: RecommendationPreferences,
  evaluationCache?: EvaluationCache,
  searchContext?: RecommendationSearchContext
): RecommendationPlan[] {
  const profile = preferences?.profile ?? "general";
  const listingPolicy = preferences?.listingPolicy ?? "retail_only";
  const priority = preferences?.priority ?? "balanced";
  const optionsByCategory = new Map<PartCategory, Map<string, PlanOption>>();
  const addPlanOption = (option: PlanOption) => {
    const options = optionsByCategory.get(option.category) ?? new Map<string, PlanOption>();
    const key = option.kind === "change_quantity"
      ? `${option.kind}:${option.suggestion.part.id}:${option.toQuantity}`
      : `${option.kind}:${option.suggestion.part.id}`;
    const existing = options.get(key);
    if (!existing
      || option.suggestion.score < existing.suggestion.score
      || similarityScoreForSort(option.suggestion) > similarityScoreForSort(existing.suggestion)) {
      options.set(key, option);
    }
    optionsByCategory.set(option.category, options);
  };

  for (const finding of result.findings) {
    if (finding.severity === "info" || finding.severity === "unknown") continue;
    const targetCategories = [...new Set(
      finding.actions
        .filter((item) => item.type === "replace_part" && item.targetCategory)
        .map((item) => item.targetCategory as PartCategory)
    )];
    for (const targetCategory of targetCategories) {
      for (const suggestion of candidateSuggestions(finding, build, catalog, 8, profile, listingPolicy, priority, targetCategory, preferences?.gamingResolution, preferences?.gamingRefreshRate, evaluationCache, searchContext)) {
        addPlanOption({ category: suggestion.part.category, suggestion, kind: "replace_part" });
      }
    }
    for (const option of quantityPlanOptions(finding, build, catalog, 8, profile, evaluationCache)) {
      addPlanOption(option);
    }
  }

  const groups = [...optionsByCategory.entries()]
    .map(([category, options]) => [category, [...options.values()]] as const)
    .filter(([, options]) => options.length > 0);
  const plans: RecommendationPlan[] = [];
  let fullCompatibilityPlan: RecommendationPlan | undefined;
  const maxChanges = Math.min(3, groups.length);

  function planForChosen(chosen: PlanOption[]): RecommendationPlan | undefined {
    const nextBuild = chosen.reduce(
      (current, option) => option.kind === "change_quantity" && option.toQuantity !== undefined
      ? setSingleSelectionQuantity(current, option.category, option.toQuantity) ?? current
        : replaceSelection(current, option.category, option.suggestion.part.id, option.suggestion.recommendedQuantity),
      build
    );
    const after = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache });
    const improved = after.blockerCount < result.blockerCount
      || after.unknownCount < result.unknownCount
      || after.warningCount < result.warningCount;
    if (!improved) return;

    const changes = chosen.map((option) => {
      const { category, suggestion } = option;
      const current = currentCategoryPart(catalog, build, category);
      const fromQuantity = selectedQuantity(build, category);
      const toQuantity = option.kind === "change_quantity" ? option.toQuantity : option.suggestion.recommendedQuantity ?? fromQuantity;
      const priceDeltaWon = option.kind === "change_quantity"
        ? suggestion.priceDeltaWon
        : suggestion.priceDeltaWon === undefined
          ? undefined
          : suggestion.recommendedQuantity !== undefined
            ? suggestion.priceDeltaWon
            : suggestion.priceDeltaWon * fromQuantity;
      return {
        kind: option.kind,
        category,
        fromPartId: current?.id,
        fromPartName: current?.name,
        toPart: suggestion.part,
        fromQuantity,
        toQuantity,
        priceDeltaWon,
        similarityScore: suggestion.similarityScore,
        similarityLabel: suggestion.similarityLabel,
        similarityEvidence: suggestion.similarityEvidence,
        performanceSummary: suggestion.performanceSummary,
        valueScore: suggestion.valueScore,
        valueLabel: suggestion.valueLabel,
        valueEvidence: suggestion.valueEvidence,
        recommendationTrust: suggestion.recommendationTrust,
        physicalEvidence: suggestion.physicalEvidence
      };
    });
    const priceDeltaWon = changes.every((change) => change.priceDeltaWon !== undefined)
      ? changes.reduce((total, change) => total + (change.priceDeltaWon ?? 0), 0)
      : undefined;
    const budgetWon = preferences?.budgetWon;
    const budgetDeltaWon = budgetWon === undefined || !after.priceComplete ? undefined : after.totalPriceWon - budgetWon;
    const withinBudget = budgetDeltaWon === undefined ? undefined : budgetDeltaWon <= 0;
    const similarityScore = Math.round(
      chosen.reduce((total, { suggestion }) => total + suggestion.similarityScore, 0) / chosen.length
    );
    const similarityEvidence = mergeSimilarityEvidence(
      chosen
        .filter((option) => option.kind === "replace_part")
        .map((option) => option.suggestion.similarityEvidence)
    );
    const resolvedFindings = result.findings.filter(
      (finding) => !after.findings.some((remaining) => remaining.ruleId === finding.ruleId)
    ).length;
    const resolvedFindingTitles = result.findings
      .filter((finding) => !after.findings.some((remaining) => remaining.ruleId === finding.ruleId))
      .map((finding) => finding.title);
    const remainingFindingTitles = after.findings.map((finding) => finding.title);
    const remainingFindingRuleIds = after.findings.map((finding) => finding.ruleId);
    const fullyCompatible = isFullyCompatible(after.blockerCount, after.warningCount, after.unknownCount);
    const label: RecommendationPlan["label"] = "최소 변경";
    const reason = fullyCompatible
      ? "이 플랜을 적용하면 현재 확인 가능한 호환 오류와 주의 항목이 모두 해결됩니다."
      : `차단 오류 ${result.blockerCount}개를 ${after.blockerCount}개로 줄입니다. ${remainingIssueSummary(after.blockerCount, after.warningCount, after.unknownCount)}는 적용 후 다시 확인할 수 있습니다.`;
    return {
      title: `${changes.length}개 항목으로 해결하는 플랜`,
      label,
      changes,
      resolvedFindings,
      resolvedFindingTitles,
      remainingFindingTitles,
      remainingFindingRuleIds,
      resolvedBlockers: Math.max(0, result.blockerCount - after.blockerCount),
      resolvedUnknown: Math.max(0, result.unknownCount - after.unknownCount),
      remainingBlockers: after.blockerCount,
      remainingWarnings: after.warningCount,
      remainingUnknown: after.unknownCount,
      afterTotalPriceWon: after.totalPriceWon,
      priceDeltaWon,
      budgetWon,
      budgetDeltaWon,
      withinBudget,
      priceComplete: after.priceComplete,
      similarityScore,
      similarityLabel: similarityEvidence ? similarityLabelFor(similarityScore, similarityEvidence.confidence) : "동급",
      similarityEvidence,
      reason,
      profileSummary: profileSummaryFor(profile)
    };
  }

  function evaluatePlan(chosen: PlanOption[]) {
    const plan = planForChosen(chosen);
    if (plan) plans.push(plan);
  }

  function visit(groupIndex: number, chosen: PlanOption[]) {
    if (chosen.length > 0) evaluatePlan(chosen);
    if (chosen.length >= maxChanges) return;
    for (let index = groupIndex; index < groups.length; index += 1) {
      const [category, options] = groups[index];
      for (const option of options.slice(0, REPAIR_PLAN_OPTIONS_PER_CATEGORY)) {
        visit(index + 1, [...chosen, option]);
      }
    }
  }
  visit(0, []);

  const fullPlanBeamWidth = 64;
  const fullPlanOptionsPerCategory = 8;
  const repairRiskScoreFor = (evaluation: CompatibilityResult) => evaluation.blockerCount * 1000 + evaluation.unknownCount * 100 + evaluation.warningCount * 10;
  const planOptionBuildFor = (current: BuildSelection, option: PlanOption) => option.kind === "change_quantity" && option.toQuantity !== undefined
    ? setSingleSelectionQuantity(current, option.category, option.toQuantity) ?? current
    : replaceSelection(current, option.category, option.suggestion.part.id, option.suggestion.recommendedQuantity);
  const fullPlanSearchPossible = result.findings
    .filter((finding) => finding.severity === "unknown")
    .every((finding) => finding.actions.some((action) => action.type === "replace_part" || action.type === "change_quantity"));
  type FullPlanBeamState = { chosen: PlanOption[]; build: BuildSelection; evaluation: CompatibilityResult };
  let fullPlanState: FullPlanBeamState | undefined;
  if (fullPlanSearchPossible) {
    let beam: FullPlanBeamState[] = [{ chosen: [], build, evaluation: result }];
    for (const [, options] of groups) {
      const expanded: FullPlanBeamState[] = [];
      for (const state of beam) {
        expanded.push(state);
        for (const option of options.slice(0, fullPlanOptionsPerCategory)) {
          const nextBuild = planOptionBuildFor(state.build, option);
          expanded.push({ chosen: [...state.chosen, option], build: nextBuild, evaluation: evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache }) });
        }
      }
      const uniqueStates = new Map<string, FullPlanBeamState>();
      for (const state of expanded) {
        const key = state.chosen.map((option) => `${option.category}:${option.kind}:${option.suggestion.part.id}:${option.toQuantity ?? ""}`).sort().join("|");
        const existing = uniqueStates.get(key);
        if (!existing || repairRiskScoreFor(state.evaluation) < repairRiskScoreFor(existing.evaluation)) uniqueStates.set(key, state);
      }
      beam = [...uniqueStates.values()]
        .sort((left, right) => {
          const leftFullyCompatible = isFullyCompatible(left.evaluation.blockerCount, left.evaluation.warningCount, left.evaluation.unknownCount);
          const rightFullyCompatible = isFullyCompatible(right.evaluation.blockerCount, right.evaluation.warningCount, right.evaluation.unknownCount);
          const riskComparison = repairRiskScoreFor(left.evaluation) - repairRiskScoreFor(right.evaluation);
          const preferenceComparison = priority === "budget"
            ? left.evaluation.totalPriceWon - right.evaluation.totalPriceWon
            : priority === "performance"
              ? right.chosen.reduce((total, option) => total + option.suggestion.similarityScore, 0) - left.chosen.reduce((total, option) => total + option.suggestion.similarityScore, 0)
              : left.chosen.length - right.chosen.length;
          return Number(rightFullyCompatible) - Number(leftFullyCompatible) || riskComparison || preferenceComparison || left.chosen.length - right.chosen.length;
        })
        .slice(0, fullPlanBeamWidth);
    }
    fullPlanState = beam
      .filter((state) => state.chosen.length > 0 && isFullyCompatible(state.evaluation.blockerCount, state.evaluation.warningCount, state.evaluation.unknownCount))
      .sort((left, right) => {
        const preferenceComparison = priority === "budget"
          ? left.evaluation.totalPriceWon - right.evaluation.totalPriceWon
          : priority === "performance"
            ? right.chosen.reduce((total, option) => total + option.suggestion.similarityScore, 0) - left.chosen.reduce((total, option) => total + option.suggestion.similarityScore, 0)
            : left.chosen.length - right.chosen.length;
        return preferenceComparison || left.chosen.length - right.chosen.length || repairRiskScoreFor(left.evaluation) - repairRiskScoreFor(right.evaluation);
      })[0];
  }
  if (fullPlanState) {
    const candidate = planForChosen(fullPlanState.chosen);
    if (candidate && isFullyCompatible(candidate.remainingBlockers, candidate.remainingWarnings, candidate.remainingUnknown)) {
      fullCompatibilityPlan = {
        ...candidate,
        label: "완전 호환",
        title: `완전 호환 우선 · ${candidate.changes.length}개 변경`,
        reason: `완전 호환을 우선해 ${candidate.changes.length}개 항목을 조정합니다. 적용 후 차단 오류·주의·확인 필요 항목이 없습니다.${candidate.priceComplete ? "" : " 가격 일부 확인이 필요합니다."}`
      };
    }
  }

  const unique = new Map<string, RecommendationPlan>();
  for (const plan of plans) {
    const key = plan.changes
      .map((change) => `${change.category}:${change.kind}:${change.toPart.id}:${change.toQuantity ?? ""}`)
      .sort()
      .join("|");
    if (!unique.has(key)) unique.set(key, plan);
  }
  const uniquePlans = [...unique.values()];
  const planQuality = (plan: RecommendationPlan) => plan.remainingBlockers * 1000
    + plan.remainingUnknown * 100
    + plan.remainingWarnings * 10;
  const planPrice = (plan: RecommendationPlan) => plan.priceDeltaWon ?? Number.MAX_SAFE_INTEGER;
  const budgetScore = (plan: RecommendationPlan) => {
    if (preferences?.budgetWon !== undefined) {
      const overBudgetPenalty = plan.withinBudget === undefined
        ? 2_000_000_000
        : plan.withinBudget
          ? 0
          : 1_000_000_000 + Math.max(0, plan.budgetDeltaWon ?? 0);
      return overBudgetPenalty + planQuality(plan) * 500 + Math.max(0, plan.priceDeltaWon ?? 0);
    }
    return planQuality(plan) * 500 + planPrice(plan);
  };
  const planKey = (plan: RecommendationPlan) => plan.changes
    .map((change) => `${change.category}:${change.kind}:${change.toPart.id}:${change.toQuantity ?? ""}`)
    .sort()
    .join("|");
  const byQuality = (a: RecommendationPlan, b: RecommendationPlan) => planQuality(a) - planQuality(b);
  const strategies: Array<{
    label: RecommendationPlan["label"];
    qualityTolerance: number;
    compare: (a: RecommendationPlan, b: RecommendationPlan) => number;
  }> = [
    {
      label: "최소 변경",
      qualityTolerance: 0,
      compare: (a, b) => byQuality(a, b)
        || a.changes.length - b.changes.length
        || similarityScoreForSort(b) - similarityScoreForSort(a)
        || planPrice(a) - planPrice(b)
    },
    {
      label: "가성비",
      qualityTolerance: 1000,
      compare: (a, b) => budgetScore(a) - budgetScore(b)
        || byQuality(a, b)
        || a.changes.length - b.changes.length
        || similarityScoreForSort(b) - similarityScoreForSort(a)
    },
    {
      label: "성능 유지",
      qualityTolerance: 1000,
      compare: (a, b) => similarityScoreForSort(b) - similarityScoreForSort(a)
        || byQuality(a, b)
        || a.changes.length - b.changes.length
        || planPrice(a) - planPrice(b)
    }
  ];
  const strategyOrder: Record<RecommendationPreferences["priority"], RecommendationPlan["label"][]> = {
    balanced: ["최소 변경", "가성비", "성능 유지"],
    budget: ["가성비", "최소 변경", "성능 유지"],
    performance: ["성능 유지", "최소 변경", "가성비"]
  };
  const orderedStrategies = strategyOrder[preferences?.priority ?? "balanced"]
    .map((label) => strategies.find((strategy) => strategy.label === label))
    .filter((strategy): strategy is (typeof strategies)[number] => Boolean(strategy));
  const usedPlans = new Set<string>();
  const usedCategorySets = new Set<string>();
  const minimumQuality = uniquePlans.reduce((minimum, plan) => Math.min(minimum, planQuality(plan)), Number.MAX_SAFE_INTEGER);
  const strategyPlans = orderedStrategies.flatMap((strategy) => {
    const sortedCandidates = [...uniquePlans]
      .sort(strategy.compare);
    const candidate = sortedCandidates.find((plan) => {
      const categories = plan.changes.map((change) => change.category).sort().join("|");
      return !usedPlans.has(planKey(plan))
        && !usedCategorySets.has(categories)
        && planQuality(plan) <= minimumQuality + strategy.qualityTolerance;
    }) ?? sortedCandidates.find((plan) => !usedPlans.has(planKey(plan)));
    if (!candidate) return [];
    usedPlans.add(planKey(candidate));
    usedCategorySets.add(candidate.changes.map((change) => change.category).sort().join("|"));
    const fullyCompatible = isFullyCompatible(candidate.remainingBlockers, candidate.remainingWarnings, candidate.remainingUnknown);
    const budgetReason = candidate.budgetWon === undefined
      ? ""
      : !candidate.priceComplete
        ? " 가격 일부 확인 필요로 예산 적합 여부를 확정하지 못합니다."
      : candidate.withinBudget
        ? ` 예산 ${formatPrice(candidate.budgetWon)} 안입니다.`
        : ` 예산을 ${formatPrice(Math.max(0, candidate.budgetDeltaWon ?? 0))} 초과합니다.`;
    const hasReplacement = candidate.changes.some((change) => change.kind === "replace_part");
    const hasQuantityChange = candidate.changes.some((change) => change.kind === "change_quantity");
    const changeLabel = hasReplacement && hasQuantityChange ? "변경" : hasReplacement ? "부품 교체" : "수량 조정";
    return [{
      ...candidate,
      label: strategy.label,
      title: `${strategy.label} · ${candidate.changes.length}개 ${changeLabel}`,
      reason: fullyCompatible
        ? `${strategy.label} 기준으로 현재 확인 가능한 호환 오류와 주의 항목을 모두 해결합니다.${budgetReason}`
        : `${strategy.label} 기준으로 차단 오류 ${result.blockerCount}개를 ${candidate.remainingBlockers}개로 줄입니다. ${remainingIssueSummary(candidate.remainingBlockers, candidate.remainingWarnings, candidate.remainingUnknown)}는 적용 후 다시 확인할 수 있습니다.${budgetReason}`
    }];
  });
  return fullCompatibilityPlan ? [...strategyPlans, fullCompatibilityPlan] : strategyPlans;
}

function attachSuggestions(
  result: CompatibilityResult,
  build: BuildSelection,
  catalog: Part[],
  evaluationCache?: EvaluationCache,
  searchContext?: RecommendationSearchContext
) {
  for (const finding of result.findings) {
    if (finding.severity === "info" || finding.severity === "unknown") continue;
    const targetCategories = [...new Set(
      finding.actions
        .filter((item) => item.type === "replace_part" && item.targetCategory)
        .map((item) => item.targetCategory as PartCategory)
    )];
    const priority = result.recommendationPreferences?.priority ?? "balanced";
    const sortedSuggestions = targetCategories
      .flatMap((targetCategory) => candidateSuggestions(
        finding,
        build,
        catalog,
        3,
        result.recommendationPreferences?.profile ?? "general",
        result.recommendationPreferences?.listingPolicy ?? "retail_only",
        priority,
        targetCategory,
        result.recommendationPreferences?.gamingResolution,
        result.recommendationPreferences?.gamingRefreshRate,
        evaluationCache,
        searchContext
      ))
      .sort((a, b) => {
        const aFullyCompatible = a.remainingBlockers === 0 && a.remainingWarnings === 0 && a.remainingUnknown === 0;
        const bFullyCompatible = b.remainingBlockers === 0 && b.remainingWarnings === 0 && b.remainingUnknown === 0;
        const priorityComparison = priority === "budget"
          ? (a.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.part.priceWon ?? Number.MAX_SAFE_INTEGER)
          : priority === "performance"
            ? compareCandidateSimilarity(a, b)
            : 0;
      return Number(bFullyCompatible) - Number(aFullyCompatible)
        || a.score - b.score
        || (priority === "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || priorityComparison
        || (priority !== "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || compareCandidateSimilarity(a, b)
          || Math.abs(a.priceDeltaWon ?? 0) - Math.abs(b.priceDeltaWon ?? 0)
          || (a.part.priceWon ?? 0) - (b.part.priceWon ?? 0);
      })
    const categoryLeaders = targetCategories.length > 1
      ? targetCategories
        .map((targetCategory) => sortedSuggestions.find((suggestion) => suggestion.part.category === targetCategory))
        .filter((suggestion): suggestion is Suggestion => Boolean(suggestion))
      : [];
    const suggestions = [...categoryLeaders, ...sortedSuggestions]
      .filter((suggestion, index, all) => all.findIndex((candidate) => candidate.part.id === suggestion.part.id) === index)
      .slice(0, 3);
    if (suggestions.length > 0) finding.suggestions = suggestions;
  }
}

type LinkPartSet = {
  cpu?: Part;
  motherboard?: Part;
  memory: SelectionWithPart[];
  ssds: SelectionWithPart[];
  hdds: SelectionWithPart[];
  computerCase?: Part;
  cooler?: Part;
  gpu?: Part;
  psu?: Part;
};

function buildCompatibilityLinks(findings: Finding[], parts: LinkPartSet): CompatibilityLink[] {
  const link = (
    definition: Omit<CompatibilityLink, "status" | "summary"> & {
      active: boolean;
      compatibleSummary: string;
    }
  ): CompatibilityLink => {
    if (!definition.active) {
      return {
        id: definition.id,
        fromCategory: definition.fromCategory,
        toCategory: definition.toCategory,
        label: definition.label,
        status: "not_applicable",
        ruleIds: definition.ruleIds,
        summary: "필요한 부품을 모두 선택하면 검사합니다."
      };
    }

    const relatedFindings = findings.filter((finding) => definition.ruleIds.includes(finding.ruleId));
    const issue = relatedFindings.find((finding) => finding.severity === "blocker" || finding.severity === "warning");
    const unknown = relatedFindings.find((finding) => finding.severity === "unknown");
    const relatedMessages = relatedFindings
      .filter((finding) => finding.severity === "blocker" || finding.severity === "warning" || finding.severity === "unknown")
      .map((finding) => finding.title)
      .slice(0, 3);
    return {
      id: definition.id,
      fromCategory: definition.fromCategory,
      toCategory: definition.toCategory,
      label: definition.label,
      status: issue ? "issue" : unknown ? "unknown" : "compatible",
      ruleIds: definition.ruleIds,
      summary: relatedMessages.length > 0 ? relatedMessages.join(" · ") : definition.compatibleSummary
    };
  };

  return [
    link({
      id: "cpu-motherboard",
      fromCategory: "cpu",
      toCategory: "motherboard",
      label: "소켓 · 전원부",
      ruleIds: ["cpu-motherboard-socket", "cpu-motherboard-power"],
      active: Boolean(parts.cpu && parts.motherboard),
      compatibleSummary: "소켓과 전원부 기준을 통과했습니다."
    }),
    link({
      id: "motherboard-gpu",
      fromCategory: "motherboard",
      toCategory: "gpu",
      label: "PCIe 장착 슬롯",
      ruleIds: ["gpu-motherboard-pcie", "m2-pcie-lane-sharing", "m2-slot-sharing"],
      active: Boolean(parts.motherboard && parts.gpu),
      compatibleSummary: "그래픽카드 장착 폭을 수용할 PCIe 슬롯이 확인됐습니다."
    }),
    link({
      id: "motherboard-memory",
      fromCategory: "motherboard",
      toCategory: "memory",
      label: "메모리 규격 · 프로파일 · 용량 · 슬롯",
      ruleIds: ["memory-type", "memory-form-factor", "memory-capacity", "memory-slots", "memory-speed", "memory-profile", "memory-mixing"],
      active: Boolean(parts.motherboard && parts.memory.length > 0),
      compatibleSummary: "규격·프로파일·용량·슬롯·속도 기준을 통과했습니다."
    }),
    link({
      id: "motherboard-ssd",
      fromCategory: "motherboard",
      toCategory: "ssd",
      label: "M.2 · PCIe 세대 · SATA 연결",
      ruleIds: ["m2-slots", "m2-interface", "m2-pcie-generation", "m2-slot-topology", "m2-slot-selection", "m2-slot-pcie-generation", "m2-slot-routing", "m2-slot-sharing", "sata-ports"],
      active: Boolean(parts.motherboard && parts.ssds.length > 0),
      compatibleSummary: "M.2 인터페이스·슬롯과 연결 포트 기준을 통과했습니다."
    }),
    link({
      id: "motherboard-hdd",
      fromCategory: "motherboard",
      toCategory: "hdd",
      label: "SATA 연결",
      ruleIds: ["sata-ports", "hdd-interface"],
      active: Boolean(parts.motherboard && parts.hdds.length > 0),
      compatibleSummary: "HDD 연결 포트 기준을 통과했습니다."
    }),
    link({
      id: "motherboard-case",
      fromCategory: "motherboard",
      toCategory: "case",
      label: "폼팩터 · 팬/RGB 연결",
      ruleIds: ["case-motherboard-form-factor", "case-fan-headers", "case-rgb-headers", "case-rgb-voltage"],
      active: Boolean(parts.motherboard && parts.computerCase),
      compatibleSummary: "메인보드 폼팩터와 팬/RGB 연결 기준을 통과했습니다."
    }),
    link({
      id: "cpu-cooler",
      fromCategory: "cpu",
      toCategory: "cooler",
      label: "소켓 · 냉각 여유",
      ruleIds: ["cpu-cooler-socket", "cpu-cooler-capacity"],
      active: Boolean(parts.cpu && parts.cooler),
      compatibleSummary: "쿨러 소켓과 냉각 여유 기준을 통과했습니다."
    }),
    link({
      id: "cooler-case",
      fromCategory: "cooler",
      toCategory: "case",
      label: "높이 · 라디에이터",
      ruleIds: ["case-cooler-height", "case-radiator-support"],
      active: Boolean(parts.cooler && parts.computerCase),
      compatibleSummary: "쿨러 높이와 라디에이터 장착 기준을 통과했습니다."
    }),
    link({
      id: "gpu-case",
      fromCategory: "gpu",
      toCategory: "case",
      label: "그래픽카드 길이 · 두께",
      ruleIds: ["gpu-case-length", "gpu-thickness"],
      active: Boolean(parts.gpu && parts.computerCase),
      compatibleSummary: "그래픽카드 길이와 두께 정보 기준을 확인했습니다."
    }),
    link({
      id: "gpu-psu",
      fromCategory: "gpu",
      toCategory: "psu",
      label: "전력 · 보조전원 연결",
      ruleIds: ["gpu-psu-power", "gpu-psu-connector", "gpu-psu-cable-topology", "psu-data-quality"],
      active: Boolean(parts.gpu && parts.psu),
      compatibleSummary: "그래픽카드 권장 전력과 보조전원 커넥터 기준을 통과했습니다."
    }),
    link({
      id: "psu-case",
      fromCategory: "psu",
      toCategory: "case",
      label: "길이 · 폼팩터",
      ruleIds: ["psu-case-length", "psu-case-form-factor"],
      active: Boolean(parts.psu && parts.computerCase),
      compatibleSummary: "파워서플라이 깊이와 케이스 지원 규격 기준을 통과했습니다."
    })
  ];
}

export function evaluateBuild(
  build: BuildSelection,
  catalog: Part[],
  options: EngineOptions = {}
): CompatibilityResult {
  const evaluationCache = options.evaluationCache ?? new Map<string, CompatibilityResult>();
  const recommendationSearchContext: RecommendationSearchContext = {
    candidateSetCount: 0,
    candidateCount: 0,
    evaluatedCandidateCount: 0,
    maxEvaluatedCandidatesPerSet: 0,
    bounded: false
  };
  const cacheKey = options.includeSuggestions === false && options.includeAnalysis !== true
    ? evaluationCacheKeyFor(build)
    : undefined;
  if (cacheKey) {
    const cached = evaluationCache.get(cacheKey);
    if (cached) return cached;
  }

  const findings: Finding[] = [];
  const cpu = selectedPart(catalog, build.cpu);
  const cooler = selectedPart(catalog, build.cooler);
  const motherboard = selectedPart(catalog, build.motherboard);
  const gpu = selectedPart(catalog, build.gpu);
  const computerCase = selectedPart(catalog, build.case);
  const psu = selectedPart(catalog, build.psu);
  const memory = selectedParts(catalog, build.memory);
  const ssds = selectedParts(catalog, build.ssd);
  const hdds = selectedParts(catalog, build.hdd);
  const m2SlotResolution = resolveM2SlotAssignments(motherboard, ssds, build.m2SlotSelection);
  const m2SlotAssignments = m2SlotResolution.assignments;
  const metrics = buildMetrics(
    build,
    cpu,
    cooler,
    motherboard,
    gpu,
    computerCase,
    psu,
    memory,
    ssds,
    hdds,
    m2SlotAssignments,
    m2SlotResolution.manual ? "manual" : "automatic"
  );

  if (!cpu) {
    addFinding(
      findings,
      "required-cpu",
      "blocker",
      "CPU를 선택해 주세요.",
      "검사를 시작하려면 CPU가 필요합니다.",
      [],
      [],
      [replaceAction("cpu")]
    );
  }
  if (!motherboard) {
    addFinding(
      findings,
      "required-motherboard",
      "blocker",
      "메인보드를 선택해 주세요.",
      "CPU와 연결되는 메인보드가 있어야 호환성을 검사할 수 있습니다.",
      [],
      [],
      [replaceAction("motherboard")]
    );
  }
  if (memory.length === 0) {
    addFinding(
      findings,
      "required-memory",
      "blocker",
      "RAM을 선택해 주세요.",
      "메모리 모듈이 하나 이상 필요합니다.",
      [],
      [],
      [replaceAction("memory")]
    );
  }
  if (!cooler && cpu?.specs.coolerIncluded !== true) {
    addFinding(
      findings,
      "required-cooler",
      "blocker",
      "CPU 쿨러를 선택해 주세요.",
      "선택한 CPU를 냉각할 쿨러가 필요합니다.",
      cpu ? [cpu.id] : [],
      [],
      [replaceAction("cooler")]
    );
  }
  if (!computerCase) {
    addFinding(
      findings,
      "required-case",
      "blocker",
      "케이스를 선택해 주세요.",
      "부품의 장착 공간을 검사하려면 케이스가 필요합니다.",
      [],
      [],
      [replaceAction("case")]
    );
  }
  if (!psu) {
    addFinding(
      findings,
      "required-psu",
      "blocker",
      "파워서플라이를 선택해 주세요.",
      "전력 공급 가능 여부를 검사하려면 파워서플라이가 필요합니다.",
      [],
      [],
      [replaceAction("psu")]
    );
  }

  if (cpu && motherboard) {
    const cpuSocket = cpu.specs.socket;
    const motherboardSocket = motherboard.specs.socket;
    if (!cpuSocket || !motherboardSocket) {
      addUnknown(
        findings,
        "cpu-motherboard-socket",
        "CPU와 메인보드의 소켓 정보를 확인할 수 없습니다.",
        "소켓 정보가 부족해 장착 가능 여부를 확정할 수 없습니다.",
        partIds(cpu, motherboard),
        [!cpuSocket ? "CPU socket" : "", !motherboardSocket ? "Motherboard socket" : ""].filter(Boolean),
        "motherboard"
      );
    } else if (cpuSocket !== motherboardSocket) {
      addFinding(
        findings,
        "cpu-motherboard-socket",
        "blocker",
        "CPU와 메인보드의 소켓이 다릅니다.",
        "두 부품은 물리적으로 장착할 수 없습니다. CPU에 맞는 메인보드 또는 메인보드에 맞는 CPU로 변경하세요.",
        partIds(cpu, motherboard),
        [
          { label: "CPU 소켓", actual: cpuSocket },
          { label: "메인보드 소켓", actual: motherboardSocket }
        ],
        [replaceAction("motherboard"), replaceAction("cpu")]
      );
    }

    const cpuPower = cpu.specs.pptW ?? cpu.specs.tdpW;
    const vrmCapacity = motherboard.specs.vrmCapacityW;
    if (cpuPower === undefined || vrmCapacity === undefined) {
      addUnknown(
        findings,
        "cpu-motherboard-power",
        "CPU 전력과 메인보드 전원부 정보를 확인할 수 없습니다.",
        "전원부 정보가 부족해 고부하 상황의 공급 가능 여부를 확정할 수 없습니다.",
        partIds(cpu, motherboard),
        [cpuPower === undefined ? "CPU power" : "", vrmCapacity === undefined ? "VRM capacity" : ""].filter(Boolean),
        "motherboard"
      );
    } else if (cpuPower > vrmCapacity) {
      addFinding(
        findings,
        "cpu-motherboard-power",
        "blocker",
        "메인보드 전원부가 CPU 요구 전력을 감당하지 못할 수 있습니다.",
        "CPU의 최대 전력 요구량이 메인보드 전원부의 확인된 공급 범위를 초과합니다.",
        partIds(cpu, motherboard),
        [
          { label: "CPU 요구 전력", actual: formatNumber(cpuPower, "W") },
          { label: "메인보드 전원부 기준", expected: formatNumber(vrmCapacity, "W") }
        ],
        [replaceAction("motherboard"), replaceAction("cpu")]
      );
    }
  }

  if (gpu && motherboard) {
    const gpuSlotWidth = gpu.specs.pcieSlotWidth;
    const motherboardX16Slots = motherboard.specs.pcieX16Slots;
    const motherboardX8Slots = motherboard.specs.pcieX8Slots;
    if (gpuSlotWidth === 16 && motherboardX16Slots === undefined) {
      addUnknown(
        findings,
        "gpu-motherboard-pcie",
        "그래픽카드와 메인보드 PCIe 슬롯 정보를 확인할 수 없습니다.",
        "그래픽카드의 PCIe x16 장착 폭과 메인보드의 확장 슬롯 정보를 확인해야 장착 가능 여부를 확정할 수 있습니다.",
        partIds(gpu, motherboard),
        ["motherboard PCIe x16 slots"],
        "motherboard"
      );
    } else if (gpuSlotWidth === 16 && motherboardX16Slots === 0) {
      addFinding(
        findings,
        "gpu-motherboard-pcie",
        "blocker",
        "그래픽카드에 맞는 PCIe x16 슬롯이 없습니다.",
        "그래픽카드는 PCIe x16 장착 폭을 요구하지만 메인보드에서 PCIe x16 슬롯이 확인되지 않습니다.",
        partIds(gpu, motherboard),
        [
          { label: "그래픽카드 PCIe 장착 폭", actual: "x16" },
          { label: "메인보드 PCIe x16 슬롯", expected: formatNumber(motherboardX16Slots, "개") }
        ],
        [replaceAction("motherboard"), replaceAction("gpu")]
      );
    } else if (gpuSlotWidth === 8 && (motherboardX16Slots ?? 0) === 0 && (motherboardX8Slots ?? 0) === 0 && (motherboardX16Slots === undefined || motherboardX8Slots === undefined)) {
      addUnknown(
        findings,
        "gpu-motherboard-pcie",
        "그래픽카드와 메인보드 PCIe 슬롯 정보를 확인할 수 없습니다.",
        "그래픽카드의 PCIe x8 장착 폭을 수용할 메인보드 슬롯 정보를 확인해야 합니다.",
        partIds(gpu, motherboard),
        ["motherboard PCIe x8/x16 slots"],
        "motherboard"
      );
    } else if (gpuSlotWidth === 8 && motherboardX16Slots === 0 && (motherboardX8Slots ?? 0) === 0) {
      addFinding(
        findings,
        "gpu-motherboard-pcie",
        "blocker",
        "그래픽카드에 맞는 PCIe 슬롯이 없습니다.",
        "그래픽카드는 PCIe x8 장착 폭을 요구하지만 메인보드에서 호환 슬롯이 확인되지 않습니다.",
        partIds(gpu, motherboard),
        [
          { label: "그래픽카드 PCIe 장착 폭", actual: "x8" },
          { label: "메인보드 PCIe 슬롯", expected: "x16 0개 · x8 0개" }
        ],
        [replaceAction("motherboard"), replaceAction("gpu")]
      );
    }
  }

  if (memory.length > 1) {
    const distinctMemoryParts = [...new Map(memory.map(({ part }) => [part.id, part])).values()];
    if (distinctMemoryParts.length > 1) {
      const comparisons: Array<{
        label: string;
        values: Array<number | string | undefined>;
        format: (value: number | string) => string;
      }> = [
        { label: "RAM 용량", values: distinctMemoryParts.map((part) => part.specs.capacityGb), format: (value) => `${value}GB` },
        { label: "RAM 속도", values: distinctMemoryParts.map((part) => part.specs.speedMhz), format: (value) => `${value}MHz` },
        { label: "메모리 타이밍", values: distinctMemoryParts.map((part) => part.specs.memoryTiming), format: (value) => String(value) },
        { label: "CAS 레이턴시", values: distinctMemoryParts.map((part) => part.specs.memoryCasLatency), format: (value) => `CL${value}` },
        { label: "전압", values: distinctMemoryParts.map((part) => part.specs.memoryVoltageV), format: (value) => `${value}V` },
        { label: "프로파일", values: distinctMemoryParts.map((part) => part.specs.memoryProfiles?.slice().sort().join(" / ")), format: (value) => String(value) },
        { label: "모듈 수/킷", values: distinctMemoryParts.map((part) => part.specs.memoryModuleCountPerKit), format: (value) => `${value}개` }
      ];
      const mismatchedFields = comparisons.filter(({ values }) => {
        const knownValues = values.filter((value): value is number | string => value !== undefined);
        return new Set(knownValues).size > 1;
      });
      const incompleteFields = comparisons.filter(({ values }) => values.some((value) => value === undefined) && values.some((value) => value !== undefined));
      const mixFacts: FindingFact[] = [
        { label: "혼용 RAM", actual: `${distinctMemoryParts.length}종` },
        ...(mismatchedFields.length > 0
          ? mismatchedFields.map(({ label, values, format }) => ({
              label,
              actual: values.map((value) => value === undefined ? "확인 필요" : format(value)).join(" / ")
            }))
          : [{ label: "비교 결과", actual: "확인된 주요 스펙은 동일합니다." }])
      ];
      const affectedMemoryIds = distinctMemoryParts.map((part) => part.id);
      if (mismatchedFields.length > 0) {
        addFinding(
          findings,
          "memory-mixing",
          "warning",
          "서로 다른 RAM 킷을 혼용하고 있습니다.",
          "RAM 킷별 속도·CL·전압·프로파일이 달라 가장 낮은 공통 설정으로 동작하거나 안정성 문제가 생길 수 있습니다. 가능한 한 같은 제품·같은 킷으로 구성하세요.",
          affectedMemoryIds,
          mixFacts,
          [replaceAction("memory", "동일 킷 RAM 후보 찾기")]
        );
      } else if (incompleteFields.length > 0) {
        addFinding(
          findings,
          "memory-mixing",
          "unknown",
          "서로 다른 RAM 킷의 혼용 안정성을 확인할 수 없습니다.",
          "서로 다른 RAM 상품을 함께 선택했지만 일부 속도·CL·전압·프로파일 정보가 없어 혼용 안정성을 확정할 수 없습니다.",
          affectedMemoryIds,
          [
            ...mixFacts,
            { label: "확인되지 않은 비교 항목", actual: incompleteFields.map(({ label }) => label).join(" / ") }
          ],
          [action("verify_spec", "RAM 킷 원문 확인", "memory")]
        );
      }
    }
  }

  if (cpu && motherboard && memory.length > 0) {
    const expectedMemoryType = motherboard.specs.memoryType ?? cpu.specs.memoryType;
    const incompatibleMemory = memory.filter(({ part }) => {
      return expectedMemoryType && part.specs.memoryType && part.specs.memoryType !== expectedMemoryType;
    });
    if (!expectedMemoryType || memory.some(({ part }) => !part.specs.memoryType)) {
      addUnknown(
        findings,
        "memory-type",
        "RAM의 메모리 규격을 확인할 수 없습니다.",
        "CPU, 메인보드, RAM 중 하나 이상의 메모리 규격 데이터가 부족합니다.",
        partIds(cpu, motherboard, ...memory.map(({ part }) => part)),
        ["memory type"],
        "memory"
      );
    } else if (incompatibleMemory.length > 0) {
      addFinding(
        findings,
        "memory-type",
        "blocker",
        "RAM의 메모리 규격이 맞지 않습니다.",
        "메인보드가 지원하지 않는 메모리 세대의 RAM이 포함되어 있습니다.",
        partIds(motherboard, ...incompatibleMemory.map(({ part }) => part)),
        [
          { label: "메인보드 지원 규격", expected: expectedMemoryType },
          ...incompatibleMemory.map(({ part }) => ({ label: `${part.name} 규격`, actual: part.specs.memoryType }))
        ],
        [replaceAction("memory"), replaceAction("motherboard")]
      );
    }

    const expectedMemoryFormFactor = motherboard.specs.memoryFormFactor;
    const memoryFormFactorMismatch = expectedMemoryFormFactor
      ? memory.filter(({ part }) => part.specs.formFactor !== undefined && part.specs.formFactor !== expectedMemoryFormFactor)
      : [];
    const shouldCheckMemoryFormFactor = expectedMemoryFormFactor !== undefined || memory.some(({ part }) => part.specs.formFactor === "SO-DIMM");
    if (shouldCheckMemoryFormFactor && (!expectedMemoryFormFactor || memory.some(({ part }) => part.specs.formFactor === undefined))) {
      addUnknown(
        findings,
        "memory-form-factor",
        "RAM과 메인보드 메모리 슬롯 규격을 확인할 수 없습니다.",
        "DIMM 또는 SO-DIMM 물리 규격 정보가 부족해 RAM을 실제로 장착할 수 있는지 확정할 수 없습니다.",
        partIds(motherboard, ...memory.map(({ part }) => part)),
        ["memory slot form factor"],
        "memory"
      );
    } else if (memoryFormFactorMismatch.length > 0) {
      addFinding(
        findings,
        "memory-form-factor",
        "blocker",
        "RAM의 물리 규격이 메인보드 슬롯과 맞지 않습니다.",
        "선택한 RAM의 DIMM/SO-DIMM 규격을 메인보드가 지원하지 않습니다. 같은 물리 규격의 RAM 또는 메인보드로 변경하세요.",
        partIds(motherboard, ...memoryFormFactorMismatch.map(({ part }) => part)),
        [
          { label: "메인보드 메모리 슬롯", expected: expectedMemoryFormFactor },
          ...memoryFormFactorMismatch.map(({ part }) => ({ label: `${part.name} 규격`, actual: part.specs.formFactor }))
        ],
        [replaceAction("memory"), replaceAction("motherboard")]
      );
    }

    const totalMemoryGb = memory.reduce(
      (total, { selection, part }) => total + (part.specs.capacityGb ?? 0) * selection.quantity,
      0
    );
    const maxMemoryGb = motherboard.specs.maxMemoryGb;
    if (maxMemoryGb === undefined || memory.some(({ part }) => part.specs.capacityGb === undefined)) {
      addUnknown(
        findings,
        "memory-capacity",
        "RAM 용량 정보를 완전히 확인할 수 없습니다.",
        "메인보드 최대 용량 또는 RAM 모듈 용량 데이터가 부족합니다.",
        partIds(motherboard, ...memory.map(({ part }) => part)),
        ["maximum memory capacity", "module capacity"].filter(
          (field) => field === "maximum memory capacity" ? maxMemoryGb === undefined : memory.some(({ part }) => part.specs.capacityGb === undefined)
        ),
        "memory"
      );
    } else if (totalMemoryGb > maxMemoryGb) {
      addFinding(
        findings,
        "memory-capacity",
        "blocker",
        "RAM 총 용량이 메인보드 지원 범위를 초과합니다.",
        "선택한 RAM의 총 용량이 메인보드가 지원하는 최대 용량보다 큽니다.",
        partIds(motherboard, ...memory.map(({ part }) => part)),
        [
          { label: "선택한 총 용량", actual: formatNumber(totalMemoryGb, "GB") },
          { label: "메인보드 최대 용량", expected: formatNumber(maxMemoryGb, "GB") }
        ],
        [action("change_quantity", "RAM 수량 줄이기", "memory"), replaceAction("motherboard")]
      );
    }

    const memoryModuleCount = physicalMemoryModuleCount(memory);
    const memorySlots = motherboard.specs.memorySlots;
    if (memorySlots === undefined) {
      addUnknown(
        findings,
        "memory-slots",
        "메인보드 RAM 슬롯 정보를 확인할 수 없습니다.",
        "RAM 모듈을 몇 개까지 장착할 수 있는지 확정할 수 없습니다.",
        [motherboard.id],
        ["memory slots"],
        "motherboard"
      );
    } else if (memoryModuleCount > memorySlots) {
      addFinding(
        findings,
        "memory-slots",
        "blocker",
        "RAM 물리 모듈 수가 메인보드 슬롯 수를 초과합니다.",
        "선택한 RAM 킷에 포함된 물리 모듈을 모두 장착할 슬롯이 부족합니다.",
        partIds(motherboard, ...memory.map(({ part }) => part)),
        [
          { label: "선택한 RAM 물리 모듈 수", actual: formatNumber(memoryModuleCount, "개") },
          { label: "메인보드 RAM 슬롯", expected: formatNumber(memorySlots, "개") }
        ],
        [action("change_quantity", "RAM 수량 줄이기", "memory"), replaceAction("motherboard")]
      );
    }

    if (memoryModuleCount !== 2) {
      addFinding(
        findings,
        "memory-dual-channel",
        "warning",
        "RAM은 2개 구성으로 사용하는 것을 권장합니다.",
        "현재 구성은 듀얼채널 또는 메모리 프로파일 성능을 충분히 활용하지 못할 수 있습니다.",
        partIds(...memory.map(({ part }) => part)),
        [{ label: "현재 RAM 물리 모듈 수", actual: formatNumber(memoryModuleCount, "개") }],
        [action("change_quantity", "RAM을 2개로 조정", "memory")]
      );
    }

    const cpuMemorySpeedRelevant = memory.some(({ part }) => (part.specs.memoryProfiles?.length ?? 0) > 0);
    const memorySpeedLimits = [
      { label: "메인보드 지원 속도", value: motherboard.specs.maxMemorySpeedMhz },
      ...(cpuMemorySpeedRelevant ? [{ label: "CPU 공식 지원 속도", value: cpu.specs.maxMemorySpeedMhz }] : [])
    ].filter((limit): limit is { label: string; value: number } => limit.value !== undefined && limit.value > 0);
    const effectiveMemorySpeedLimit = memorySpeedLimits.length > 0
      ? Math.min(...memorySpeedLimits.map((limit) => limit.value))
      : undefined;
    const unsupportedSpeed = memory.filter(({ part }) => {
      return part.specs.speedMhz !== undefined && effectiveMemorySpeedLimit !== undefined && part.specs.speedMhz > effectiveMemorySpeedLimit;
    });
    const missingSpeedFields = [
      ...(motherboard.specs.maxMemorySpeedMhz === undefined ? ["motherboard supported memory speed"] : []),
      ...(cpuMemorySpeedRelevant && cpu.specs.maxMemorySpeedMhz === undefined ? ["CPU supported memory speed"] : []),
      ...(memory.some(({ part }) => part.specs.speedMhz === undefined) ? ["memory speed"] : [])
    ];
    const requiredMemorySpeedLimitCount = cpuMemorySpeedRelevant ? 2 : 1;
    if (memorySpeedLimits.length < requiredMemorySpeedLimitCount || memory.some(({ part }) => part.specs.speedMhz === undefined)) {
      addUnknown(
        findings,
        "memory-speed",
        "RAM 속도 정보를 완전히 확인할 수 없습니다.",
        "메모리 속도 또는 CPU·메인보드의 공식 지원 속도 데이터가 부족합니다.",
        partIds(motherboard, ...memory.map(({ part }) => part)),
        missingSpeedFields.length > 0 ? missingSpeedFields : ["supported memory speed"],
        "memory"
      );
    } else if (unsupportedSpeed.length > 0) {
      addFinding(
        findings,
        "memory-speed",
        "warning",
        "RAM 속도가 CPU·메인보드의 확인된 지원 상한을 초과합니다.",
        "사용은 가능할 수 있지만 CPU와 메인보드 중 낮은 공식 지원 속도로 동작하거나 다운클럭될 수 있습니다.",
        partIds(motherboard, ...unsupportedSpeed.map(({ part }) => part)),
        [
          { label: "RAM 속도", actual: formatNumber(Math.max(...unsupportedSpeed.map(({ part }) => part.specs.speedMhz ?? 0)), "MHz") },
          { label: "유효 확인 상한", expected: formatNumber(effectiveMemorySpeedLimit, "MHz") },
          ...memorySpeedLimits.map(({ label, value }) => ({ label, expected: formatNumber(value, "MHz") }))
        ],
        [replaceAction("memory"), replaceAction("motherboard")]
      );
    }

  }

  if (motherboard && memory.length > 0) {
    const profileMemory = memory.filter(({ part }) => (part.specs.memoryProfiles?.length ?? 0) > 0);
    const boardMemoryProfiles = motherboard.specs.memoryProfiles;
    const profileMismatch = boardMemoryProfiles && profileMemory.some(({ part }) => !part.specs.memoryProfiles?.some((profile) => boardMemoryProfiles.includes(profile)));
    if (profileMemory.length > 0 && boardMemoryProfiles === undefined) {
      addUnknown(
        findings,
        "memory-profile",
        "RAM 프로파일과 메인보드 지원 정보를 확인할 수 없습니다.",
        "EXPO/XMP 프로파일이 있는 RAM을 선택했지만 메인보드의 지원 프로파일 원문이 없어 설정 가능 여부를 확정할 수 없습니다.",
        partIds(motherboard, ...profileMemory.map(({ part }) => part)),
        ["motherboard memory profiles"],
        "memory"
      );
    } else if (profileMismatch) {
      addFinding(
        findings,
        "memory-profile",
        "warning",
        "RAM 프로파일과 메인보드 지원 프로파일이 다릅니다.",
        "선택한 RAM의 EXPO/XMP 프로파일과 메인보드의 지원 프로파일이 일치하지 않아 기본 속도로 동작하거나 수동 설정이 필요할 수 있습니다.",
        partIds(motherboard, ...profileMemory.map(({ part }) => part)),
        [
          { label: "RAM 프로파일", actual: formatMemoryProfiles([...new Set(profileMemory.flatMap(({ part }) => part.specs.memoryProfiles ?? []))]) },
          { label: "메인보드 지원 프로파일", expected: formatMemoryProfiles(boardMemoryProfiles) }
        ],
        [replaceAction("memory"), replaceAction("motherboard")]
      );
    }
  }

  if (motherboard && (ssds.length > 0 || hdds.length > 0)) {
    const m2Count = ssds.reduce(
      (total, { selection, part }) =>
        total + (part.specs.formFactor?.toLocaleLowerCase().includes("m.2") ? selection.quantity : 0),
      0
    );
    const m2Slots = motherboard.specs.m2Slots;
    if (m2Slots === undefined || ssds.some(({ part }) => part.specs.formFactor === undefined)) {
      addUnknown(
        findings,
        "m2-slots",
        "M.2 SSD 또는 메인보드 슬롯 정보를 확인할 수 없습니다.",
        "M.2 장착 가능 개수를 확정할 수 없습니다.",
        partIds(motherboard, ...ssds.map(({ part }) => part)),
        ["M.2 slots"],
        "motherboard"
      );
    } else if (m2Count > m2Slots) {
      addFinding(
        findings,
        "m2-slots",
        "blocker",
        "M.2 SSD 개수가 메인보드 슬롯 수를 초과합니다.",
        "선택한 M.2 SSD를 모두 장착할 슬롯이 부족합니다.",
        partIds(motherboard, ...ssds.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "메인보드 M.2 슬롯", expected: formatNumber(m2Slots, "개") }
        ],
        [action("change_quantity", "M.2 SSD 수량 줄이기", "ssd"), replaceAction("motherboard")]
      );
    }

    const m2Parts = ssds.filter(({ part }) => part.specs.formFactor?.toLocaleLowerCase().includes("m.2"));
    const m2InterfaceCounts = new Map<"NVMe" | "SATA", number>();
    for (const { selection, part } of m2Parts) {
      if (part.specs.interface === "NVMe" || part.specs.interface === "SATA") {
        m2InterfaceCounts.set(part.specs.interface, (m2InterfaceCounts.get(part.specs.interface) ?? 0) + selection.quantity);
      }
    }
    const m2UnknownInterfaceParts = m2Parts.filter(({ part }) => part.specs.interface === undefined);
    const m2Interfaces = motherboard.specs.m2Interfaces;
    const unsupportedM2Parts = m2Interfaces
      ? m2Parts.filter(({ part }) => (part.specs.interface === "NVMe" || part.specs.interface === "SATA") && !m2Interfaces.includes(part.specs.interface))
      : [];
    if (m2Parts.length > 0 && (!m2Interfaces || m2UnknownInterfaceParts.length > 0)) {
      const missingM2InterfaceLabels = [
        !m2Interfaces ? "motherboard M.2 interfaces" : "",
        m2UnknownInterfaceParts.length > 0 ? "M.2 SSD interface" : ""
      ].filter(Boolean);
      addUnknown(
        findings,
        "m2-interface",
        "M.2 SSD와 메인보드 M.2 연결 정보를 확인할 수 없습니다.",
        "선택한 M.2 SSD의 NVMe/SATA 연결 방식 또는 메인보드의 M.2 연결 원문이 부족해 장착 가능 여부를 확정할 수 없습니다.",
        partIds(motherboard, ...m2Parts.map(({ part }) => part)),
        missingM2InterfaceLabels,
        "motherboard"
      );
    } else if (unsupportedM2Parts.length > 0 && m2Interfaces) {
      const onlySataUnsupported = unsupportedM2Parts.every(({ part }) => part.specs.interface === "SATA");
      const onlyNvmeUnsupported = unsupportedM2Parts.every(({ part }) => part.specs.interface === "NVMe");
      const unsupportedLabel = onlySataUnsupported
        ? "SATA 방식 M.2 SSD"
        : onlyNvmeUnsupported
          ? "NVMe 방식 M.2 SSD"
          : "선택한 M.2 SSD";
      const unsupportedCount = unsupportedM2Parts.reduce((total, { selection }) => total + selection.quantity, 0);
      const unsupportedFactLabel = onlySataUnsupported
        ? "선택한 SATA M.2 SSD"
        : onlyNvmeUnsupported
          ? "선택한 NVMe M.2 SSD"
          : "선택한 M.2 SSD";
      addFinding(
        findings,
        "m2-interface",
        "blocker",
        `${unsupportedLabel}를 메인보드가 지원하지 않습니다.`,
        `선택한 ${unsupportedLabel}와 메인보드에서 확인된 M.2 연결 방식이 맞지 않습니다. 지원되는 M.2 인터페이스의 SSD 또는 메인보드로 변경하세요.`,
        partIds(motherboard, ...unsupportedM2Parts.map(({ part }) => part)),
        [
          { label: unsupportedFactLabel, actual: formatNumber(unsupportedCount, "개") },
          { label: "메인보드 M.2 연결", expected: m2Interfaces.join(", ") }
        ],
        [replaceAction("ssd"), replaceAction("motherboard")]
      );
    }

    const motherboardM2PcieGenerations = motherboard.specs.m2PcieGenerations;
    const motherboardMaxM2PcieGeneration = motherboardM2PcieGenerations && motherboardM2PcieGenerations.length > 0
      ? Math.max(...motherboardM2PcieGenerations)
      : undefined;
    const nvmePcieParts = m2Parts.filter(({ part }) => part.specs.interface === "NVMe" && part.specs.m2PcieGeneration !== undefined);
    const slowerNvmeParts = motherboardMaxM2PcieGeneration !== undefined
      ? nvmePcieParts.filter(({ part }) => (part.specs.m2PcieGeneration ?? 0) > motherboardMaxM2PcieGeneration)
      : [];
    const formatPcieGeneration = (value: number) => `PCIe ${value.toFixed(1)}`;
    if (slowerNvmeParts.length > 0 && motherboardMaxM2PcieGeneration !== undefined) {
      addFinding(
        findings,
        "m2-pcie-generation",
        "warning",
        "NVMe SSD PCIe 세대가 메인보드 M.2 지원 세대보다 높습니다.",
        "SSD는 장착될 수 있지만 메인보드의 낮은 PCIe 세대로 링크되어 순차 성능이 낮아질 수 있습니다.",
        partIds(motherboard, ...slowerNvmeParts.map(({ part }) => part)),
        [
          { label: "NVMe SSD PCIe 세대", actual: [...new Set(slowerNvmeParts.map(({ part }) => part.specs.m2PcieGeneration).filter((value): value is number => value !== undefined))].map(formatPcieGeneration).join(" / ") },
          { label: "메인보드 M.2 지원 세대", expected: motherboardM2PcieGenerations!.map(formatPcieGeneration).join(" / ") },
          { label: "실제 링크 상한", expected: formatPcieGeneration(motherboardMaxM2PcieGeneration) }
        ],
        [replaceAction("ssd"), replaceAction("motherboard")]
      );
    }

    const motherboardHasMixedM2PcieGenerations = motherboardM2PcieGenerations !== undefined
      && new Set(motherboardM2PcieGenerations).size > 1;
    const m2SlotProfiles = motherboard.specs.m2SlotProfiles;
    const m2SlotProfilesComplete = m2SlotResolution.profilesComplete;
    const hasConfiguredM2SlotProfiles = m2SlotProfiles !== undefined && m2SlotProfiles.length > 0;
    const hasManualM2SlotSelection = m2SlotResolution.manual;
    if (hasManualM2SlotSelection && m2SlotResolution.error) {
      addFinding(
        findings,
        "m2-slot-selection",
        "blocker",
        "수동 M.2 슬롯 배치를 적용할 수 없습니다.",
        m2SlotResolution.error,
        partIds(motherboard, ...m2Parts.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "수동 지정 슬롯", actual: Object.keys(build.m2SlotSelection ?? {}).join(" · ") || "없음" }
        ],
        [action("verify_spec", "M.2 슬롯 배치 확인", "motherboard")]
      );
    }
    const topologyNeedsReview = m2Count > 1
      && m2Slots !== undefined
      && m2Count <= m2Slots
      && m2Interfaces !== undefined
      && !m2SlotProfilesComplete
      && !hasManualM2SlotSelection
      && (motherboardHasMixedM2PcieGenerations || hasConfiguredM2SlotProfiles);
    if (topologyNeedsReview) {
      addFinding(
        findings,
        "m2-slot-topology",
        "unknown",
        "M.2 슬롯별 PCIe 세대 배치를 확정할 수 없습니다.",
        "메인보드 원문에는 여러 M.2 PCIe 세대가 집계되어 있지만, 각 SSD가 어느 슬롯에 연결되는지 확인되지 않아 다중 M.2 구성의 세대·레인 배치를 자동 확정할 수 없습니다.",
        partIds(motherboard, ...m2Parts.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "메인보드 확인 PCIe 세대", actual: motherboardM2PcieGenerations!.map(formatPcieGeneration).join(" / ") },
          { label: "확인 필요", actual: "M2_1·M2_2·M2_3별 PCIe 세대·CPU 직결·레인 공유" }
        ],
        [action("verify_spec", "M.2 슬롯별 세대·레인 확인", "motherboard")]
      );
    }

    if (m2SlotProfilesComplete && m2Count > 0 && m2Slots !== undefined && m2Count <= m2Slots
      && (!m2SlotAssignments || !m2SlotResolution.compatible)
      && !m2SlotResolution.error) {
      addFinding(
        findings,
        "m2-slot-routing",
        "blocker",
        hasManualM2SlotSelection ? "수동 지정한 M.2 슬롯에 SSD를 연결할 수 없습니다." : "M.2 SSD를 등록된 슬롯에 연결할 수 없습니다.",
        hasManualM2SlotSelection
          ? "지정한 슬롯의 M.2 인터페이스 조건과 SSD의 연결 방식이 맞지 않습니다. 다른 슬롯으로 배치하거나 SSD를 바꿔 주세요."
          : "관리자가 등록한 슬롯별 M.2 인터페이스 조건과 선택한 SSD의 연결 방식이 맞지 않아 모든 SSD의 장착 위치를 구성할 수 없습니다.",
        partIds(motherboard, ...m2Parts.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "등록된 M.2 슬롯", expected: m2SlotProfiles!.map((profile) => `${profile.slotId}: ${profile.interfaces!.join(" / ")}`).join(" · ") }
        ],
        [replaceAction("ssd"), replaceAction("motherboard")]
      );
    }

    const downgradedM2SlotAssignments = (m2SlotAssignments ?? []).filter(
      (assignment) => assignment.ssdPcieGeneration !== undefined
        && assignment.slotPcieGeneration !== undefined
        && assignment.ssdPcieGeneration > assignment.slotPcieGeneration
    );
    if (downgradedM2SlotAssignments.length > 0) {
      addFinding(
        findings,
        "m2-slot-pcie-generation",
        "warning",
        "일부 M.2 SSD가 낮은 PCIe 세대 슬롯에 배치됩니다.",
        "등록된 슬롯 배치 기준으로 해당 SSD는 더 낮은 PCIe 세대로 링크됩니다. SSD 또는 슬롯별 배치를 변경해 성능 저하를 피할 수 있습니다.",
        [motherboard.id, ...downgradedM2SlotAssignments.map((assignment) => assignment.partId)],
        [
          { label: "슬롯별 연결", actual: downgradedM2SlotAssignments.map((assignment) => `${assignment.slotId}: SSD PCIe ${assignment.ssdPcieGeneration!.toFixed(1)} → 슬롯 PCIe ${assignment.slotPcieGeneration!.toFixed(1)}`).join(" / ") },
          { label: "실제 링크 세대", expected: downgradedM2SlotAssignments.map((assignment) => `${assignment.slotId} PCIe ${assignment.linkGeneration?.toFixed(1) ?? "확인 필요"}`).join(" / ") }
        ],
        [replaceAction("ssd"), replaceAction("motherboard")]
      );
    }

    const activeM2SharedAssignments = (m2SlotAssignments ?? []).filter(
      (assignment) => assignment.sharedWith && assignment.sharedWith.length > 0
        && (Boolean(gpu) || ssds.some(({ part }) => part.specs.interface === "SATA") || hdds.length > 0)
    );
    if (activeM2SharedAssignments.length > 0) {
      addFinding(
        findings,
        "m2-slot-sharing",
        "unknown",
        "M.2 슬롯이 다른 연결과 공유됩니다.",
        "등록된 제조사 매뉴얼 기준으로 선택한 M.2 슬롯에 공유 대상이 있지만, 해당 대상이 언제 비활성화되거나 링크 폭을 바꾸는지까지는 자동 확정하지 않습니다.",
        [motherboard.id, ...activeM2SharedAssignments.map((assignment) => assignment.partId), ...(gpu ? [gpu.id] : [])],
        [
          { label: "공유 슬롯", actual: activeM2SharedAssignments.map((assignment) => `${assignment.slotId}: ${assignment.sharedWith!.join(", ")}`).join(" / ") },
          { label: "함께 선택한 연결", actual: [gpu ? "GPU PCIe" : "", ssds.some(({ part }) => part.specs.interface === "SATA") || hdds.length > 0 ? "SATA 저장장치" : ""].filter(Boolean).join(" / ") }
        ],
        [action("verify_spec", "M.2 공유 조건 확인", "motherboard")]
      );
    }

    const m2LaneSharingScopes = motherboard.specs.m2LaneSharingScopes;
    const hasPcieLaneSharing = m2LaneSharingScopes !== undefined
      ? m2LaneSharingScopes.includes("pcie")
      : motherboard.specs.m2LaneSharing === true;
    if (m2Count > 0 && gpu && hasPcieLaneSharing) {
      addFinding(
        findings,
        "m2-pcie-lane-sharing",
        "unknown",
        "M.2 사용이 GPU의 PCIe 연결에 영향을 주는지 확인할 수 없습니다.",
        "메인보드 원문에 M.2와 PCIe 레인 공유 신호가 있지만, 공유 대상 슬롯·발생 조건·비활성화 여부가 없어 GPU PCIe 영향을 확정할 수 없습니다. 제조사 매뉴얼을 확인하세요.",
        partIds(motherboard, gpu, ...ssds.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "GPU PCIe 장착 폭", actual: gpu.specs.pcieSlotWidth === undefined ? "확인 필요" : `x${gpu.specs.pcieSlotWidth}` },
          { label: "M.2 공유 범위", actual: m2LaneSharingScopes?.join(", ") ?? "PCIe" },
          { label: "메인보드 원문 표기", actual: motherboard.specs.m2LaneSharingNote ?? "레인공유" }
        ],
        [action("verify_spec", "M.2·PCIe 슬롯 공유 확인", "motherboard")]
      );
    }

    if (hdds.length > 0) {
      const unknownHddInterfaces = hdds.filter(({ part }) => part.specs.interface === undefined);
      const unsupportedHddInterfaces = hdds.filter(({ part }) => part.specs.interface !== undefined && part.specs.interface !== "SATA");
      if (unknownHddInterfaces.length > 0) {
        addUnknown(
          findings,
          "hdd-interface",
          "HDD의 내부 연결 인터페이스를 확인할 수 없습니다.",
          "HDD 원문에 SATA 연결인지 확정할 수 있는 정보가 없어 메인보드에 직접 연결 가능한지 확인해야 합니다.",
          partIds(motherboard, ...unknownHddInterfaces.map(({ part }) => part)),
          ["HDD interface"],
          "hdd"
        );
      } else if (unsupportedHddInterfaces.length > 0) {
        addFinding(
          findings,
          "hdd-interface",
          "blocker",
          "HDD의 내부 연결 인터페이스가 메인보드와 맞지 않습니다.",
          "선택한 HDD가 SATA가 아닌 SAS 등 별도 컨트롤러가 필요한 인터페이스라 일반 SATA 메인보드에 직접 연결할 수 없습니다.",
          partIds(motherboard, ...unsupportedHddInterfaces.map(({ part }) => part)),
          [
            { label: "메인보드 저장장치 포트", expected: "SATA" },
            ...unsupportedHddInterfaces.map(({ part }) => ({ label: `${part.name} 인터페이스`, actual: part.specs.interface }))
          ],
          [replaceAction("hdd"), replaceAction("motherboard")]
        );
      }
    }

    const sataStorageCount = ssds.reduce(
      (total, { selection, part }) =>
        total + (part.specs.interface?.toLocaleLowerCase().includes("sata") ? selection.quantity : 0),
      0
    ) + hdds.reduce((total, { selection }) => total + selection.quantity, 0);
    if (motherboard.specs.sataPorts !== undefined && sataStorageCount > motherboard.specs.sataPorts) {
      addFinding(
        findings,
        "sata-ports",
        "blocker",
        "SATA 저장장치 수가 메인보드 포트 수를 초과합니다.",
        "선택한 SATA SSD와 HDD를 연결할 SATA 포트가 부족합니다.",
        partIds(motherboard, ...ssds.map(({ part }) => part), ...hdds.map(({ part }) => part)),
        [
          { label: "선택한 SATA 저장장치", actual: formatNumber(sataStorageCount, "개") },
          { label: "메인보드 SATA 포트", expected: formatNumber(motherboard.specs.sataPorts, "개") }
        ],
        [
          ...(ssds.length > 0 ? [action("change_quantity", "SSD 수량 줄이기", "ssd")] : []),
          ...(hdds.length > 0 ? [action("change_quantity", "HDD 수량 줄이기", "hdd")] : []),
          replaceAction("motherboard")
        ]
      );
    }
  }

  if (computerCase && hdds.length > 0) {
    const hddCount = hdds.reduce((total, { selection }) => total + selection.quantity, 0);
    const hddBays = computerCase.specs.hddBays;
    if (hddBays === undefined || hdds.some(({ part }) => !part.specs.formFactor)) {
      addUnknown(
        findings,
        "case-hdd-bays",
        "케이스와 HDD 장착 공간 정보를 확인할 수 없습니다.",
        "HDD를 실제로 장착할 수 있는지 확정할 수 없습니다.",
        partIds(computerCase, ...hdds.map(({ part }) => part)),
        ["3.5-inch bays"],
        "case"
      );
    } else if (hddCount > hddBays) {
      addFinding(
        findings,
        "case-hdd-bays",
        "blocker",
        "HDD 개수가 케이스의 장착 공간을 초과합니다.",
        "선택한 HDD를 모두 넣을 3.5인치 장착 공간이 부족합니다.",
        partIds(computerCase, ...hdds.map(({ part }) => part)),
        [
          { label: "선택한 HDD", actual: formatNumber(hddCount, "개") },
          { label: "케이스 HDD 베이", expected: formatNumber(hddBays, "개") }
        ],
        [action("change_quantity", "HDD 수량 줄이기", "hdd"), replaceAction("case")]
      );
    }
  }

  if (motherboard && computerCase && motherboard.specs.formFactor) {
    const supported = computerCase.specs.motherboardFormFactors;
    if (!supported) {
      addUnknown(
        findings,
        "case-motherboard-form-factor",
        "케이스의 메인보드 규격 정보를 확인할 수 없습니다.",
        "선택한 메인보드가 케이스에 들어가는지 확정할 수 없습니다.",
        partIds(motherboard, computerCase),
        ["supported motherboard form factors"],
        "case"
      );
    } else if (!supported.includes(motherboard.specs.formFactor)) {
      addFinding(
        findings,
        "case-motherboard-form-factor",
        "blocker",
        "메인보드 규격이 케이스와 맞지 않습니다.",
        "선택한 메인보드 폼팩터를 케이스가 지원하지 않습니다.",
        partIds(motherboard, computerCase),
        [
          { label: "메인보드 규격", actual: motherboard.specs.formFactor },
          { label: "케이스 지원 규격", expected: supported.join(", ") }
        ],
        [replaceAction("case"), replaceAction("motherboard")]
      );
    }
  }

  if (motherboard && computerCase) {
    const caseFanCount = computerCase.specs.fanCount;
    const motherboardFanPorts = motherboard.specs.fanPortCount;
    if (caseFanCount !== undefined && motherboardFanPorts === undefined) {
      addUnknown(
        findings,
        "case-fan-headers",
        "케이스 팬과 메인보드 팬 헤더 정보를 확인할 수 없습니다.",
        "케이스 기본 팬은 확인됐지만 메인보드 팬 헤더가 없어 직접 연결 가능 여부를 확정할 수 없습니다. 팬 허브 포함 여부도 확인하세요.",
        partIds(motherboard, computerCase),
        ["motherboard fan headers"],
        "motherboard"
      );
    } else if (caseFanCount !== undefined && motherboardFanPorts !== undefined && caseFanCount > motherboardFanPorts) {
      addFinding(
        findings,
        "case-fan-headers",
        "warning",
        "케이스 기본 팬 수가 메인보드 팬 헤더 수를 초과합니다.",
        "팬을 메인보드에 직접 연결할 헤더가 부족할 수 있습니다. 케이스 팬 허브 또는 SATA 전원 컨트롤러 포함 여부를 확인하세요.",
        partIds(motherboard, computerCase),
        [
          { label: "케이스 기본 팬", actual: formatNumber(caseFanCount, "개") },
          { label: "메인보드 팬 헤더", expected: formatNumber(motherboardFanPorts, "개") }
        ],
        [action("verify_spec", "팬 허브·컨트롤러 확인", "case")]
      );
    }
    const caseRgbDevices = computerCase.specs.rgbDeviceCount;
    const motherboardRgbPorts = motherboard.specs.rgbPortCount;
    if (caseRgbDevices !== undefined && caseRgbDevices > 0 && motherboardRgbPorts === undefined) {
      addUnknown(
        findings,
        "case-rgb-headers",
        "케이스 RGB 장치와 메인보드 RGB 헤더 정보를 확인할 수 없습니다.",
        "RGB 장치를 연결할 헤더 또는 기본 RGB 컨트롤러 정보를 확인할 수 없어 연결 가능 여부를 확정할 수 없습니다.",
        partIds(motherboard, computerCase),
        ["motherboard RGB/ARGB headers"],
        "motherboard"
      );
    } else if (caseRgbDevices !== undefined && caseRgbDevices > 0 && motherboardRgbPorts !== undefined && caseRgbDevices > motherboardRgbPorts) {
      addFinding(
        findings,
        "case-rgb-headers",
        "warning",
        "케이스 RGB 장치 수가 메인보드 RGB 헤더 수를 초과할 수 있습니다.",
        "RGB 헤더에 장치를 직접 연결하기 부족할 수 있습니다. 5V ARGB·12V RGB 전압과 RGB 허브 포함 여부를 확인하세요.",
        partIds(motherboard, computerCase),
        [
          { label: "케이스 RGB 장치", actual: formatNumber(caseRgbDevices, "개") },
          { label: "메인보드 RGB/ARGB 헤더", expected: formatNumber(motherboardRgbPorts, "개") }
        ],
        [action("verify_spec", "RGB 허브·전압 확인", "motherboard")]
      );
    }
    const caseRgbVoltage = computerCase.specs.rgbDeviceVoltage;
    if (caseRgbDevices !== undefined && caseRgbDevices > 0 && caseRgbVoltage) {
      const requiredVoltages = caseRgbVoltage === "mixed" ? ["5V", "12V"] : [caseRgbVoltage];
      const voltageHeaders = new Map<string, number | undefined>([
        ["5V", motherboard.specs.rgb5vPortCount],
        ["12V", motherboard.specs.rgb12vPortCount]
      ]);
      const missingVoltageData = requiredVoltages.filter((voltage) => voltageHeaders.get(voltage) === undefined);
      const missingVoltageHeaders = requiredVoltages.filter((voltage) => voltageHeaders.get(voltage) === 0);
      if (missingVoltageData.length > 0) {
        addUnknown(
          findings,
          "case-rgb-voltage",
          "케이스 RGB 전압과 메인보드 헤더 전압을 확인할 수 없습니다.",
          "케이스 RGB 장치 타입은 확인됐지만 메인보드의 5V ARGB·12V RGB 헤더별 정보가 부족해 안전한 연결 여부를 확정할 수 없습니다.",
          partIds(motherboard, computerCase),
          ["motherboard RGB header voltage"],
          "motherboard"
        );
      } else if (missingVoltageHeaders.length > 0) {
        addFinding(
          findings,
          "case-rgb-voltage",
          "warning",
          "케이스 RGB 장치와 메인보드 헤더 전압이 맞지 않을 수 있습니다.",
          "케이스 RGB 장치에 필요한 전압의 메인보드 헤더가 확인되지 않았습니다. 5V ARGB와 12V RGB를 혼용하지 말고 전용 컨트롤러의 전압을 제조사 원문에서 확인하세요.",
          partIds(motherboard, computerCase),
          [
            { label: "케이스 RGB 전압", actual: caseRgbVoltage === "mixed" ? "5V + 12V" : caseRgbVoltage },
            { label: "메인보드 5V ARGB 헤더", actual: formatNumber(motherboard.specs.rgb5vPortCount, "개") },
            { label: "메인보드 12V RGB 헤더", actual: formatNumber(motherboard.specs.rgb12vPortCount, "개") }
          ],
          [action("verify_spec", "RGB 컨트롤러·전압 확인", "motherboard")]
        );
      }
    }
  }

  if (cpu && cooler) {
    const cpuSocket = cpu.specs.socket;
    const supportedSockets = cooler.specs.supportedSockets;
    if (!cpuSocket || !supportedSockets) {
      addUnknown(
        findings,
        "cpu-cooler-socket",
        "CPU 쿨러의 소켓 호환 정보를 확인할 수 없습니다.",
        "쿨러 장착 브라켓 정보를 확인할 수 없어 장착 가능 여부를 확정할 수 없습니다.",
        partIds(cpu, cooler),
        ["cooler supported sockets"],
        "cooler"
      );
    } else if (!supportedSockets.includes(cpuSocket)) {
      addFinding(
        findings,
        "cpu-cooler-socket",
        "blocker",
        "CPU 쿨러가 CPU 소켓을 지원하지 않습니다.",
        "선택한 쿨러를 CPU에 장착할 수 있는 브라켓이 없습니다.",
        partIds(cpu, cooler),
        [
          { label: "CPU 소켓", actual: cpuSocket },
          { label: "쿨러 지원 소켓", expected: supportedSockets.join(", ") }
        ],
        [replaceAction("cooler"), replaceAction("cpu")]
      );
    }

    const cpuHeat = cpu.specs.pptW ?? cpu.specs.tdpW;
    const coolerCapacity = cooler.specs.maxCoolingW;
    if (cpuHeat !== undefined && coolerCapacity !== undefined && cpuHeat > coolerCapacity) {
      addFinding(
        findings,
        "cpu-cooler-capacity",
        "warning",
        "CPU의 전력·발열 수준에 비해 쿨러 여유가 부족할 수 있습니다.",
        "고부하에서 온도와 소음이 높아질 수 있으므로 더 큰 쿨러를 권장합니다.",
        partIds(cpu, cooler),
        [
          { label: "CPU 기준 전력", actual: formatNumber(cpuHeat, "W") },
          { label: "쿨러 확인 용량", expected: formatNumber(coolerCapacity, "W") }
        ],
        [replaceAction("cooler")]
      );
    }
  }

  if (cpu && computerCase && cooler) {
    const coolerHeight = cooler.specs.maxCoolerHeightMm;
    const caseHeight = computerCase.specs.maxCoolerHeightMm;
    if (coolerHeight !== undefined && caseHeight !== undefined && coolerHeight > caseHeight) {
      addFinding(
        findings,
        "case-cooler-height",
        "blocker",
        "CPU 쿨러 높이가 케이스 허용 높이를 초과합니다.",
        "선택한 쿨러가 케이스 측판과 간섭할 수 있습니다.",
        partIds(cooler, computerCase),
        [
          { label: "쿨러 높이", actual: formatNumber(coolerHeight, "mm") },
          { label: "케이스 허용 높이", expected: formatNumber(caseHeight, "mm") }
        ],
        [replaceAction("cooler"), replaceAction("case")]
      );
    }
    if (cooler.specs.coolerType === "liquid") {
      const radiatorSize = cooler.specs.radiatorSizeMm;
      const radiatorSupports = computerCase.specs.radiatorSupports ?? [];
      const supportedRadiators = [...new Set([
        ...(computerCase.specs.radiatorSizesMm ?? []),
        ...radiatorSupports.flatMap((support) => support.sizesMm)
      ])];
      const coolerPosition = cooler.specs.radiatorPosition;
      const positionSupport = coolerPosition ? radiatorSupports.find((support) => support.position === coolerPosition) : undefined;
      if (radiatorSize === undefined || supportedRadiators.length === 0) {
        addUnknown(
          findings,
          "case-radiator-support",
          "수랭 쿨러와 케이스의 라디에이터 지원 정보를 확인할 수 없습니다.",
          "라디에이터 크기 또는 케이스 지원 규격 데이터가 부족해 장착 가능 여부를 확정할 수 없습니다.",
          partIds(cooler, computerCase),
          [radiatorSize === undefined ? "radiator size" : "case radiator support"],
          "case"
        );
      } else if (radiatorSupports.length > 0 && coolerPosition === undefined) {
        addFinding(
          findings,
          "case-radiator-support",
          "unknown",
          "수랭 쿨러의 라디에이터 장착 위치를 확인할 수 없습니다.",
          "케이스의 위치별 라디에이터 지원 정보는 확인됐지만 쿨러의 장착 위치가 원문에 없어 실제 장착 여부를 확정할 수 없습니다.",
          partIds(cooler, computerCase),
          [
            { label: "라디에이터 크기", actual: formatNumber(radiatorSize, "mm") },
            { label: "케이스 지원 위치", expected: radiatorSupports.map((support) => `${radiatorPositionLabel(support.position)}: ${support.sizesMm.map((size) => `${size}mm`).join(", ")}`).join(" · ") },
            { label: "쿨러 장착 위치", actual: "확인 필요" }
          ],
          [action("verify_spec", "쿨러 라디에이터 장착 위치 확인", "cooler"), replaceAction("cooler")]
        );
      } else if (radiatorSupports.length > 0 && (!positionSupport || !positionSupport.sizesMm.includes(radiatorSize))) {
        addFinding(
          findings,
          "case-radiator-support",
          "blocker",
          "수랭 쿨러의 라디에이터 위치·크기를 케이스가 지원하지 않습니다.",
          "선택한 쿨러의 라디에이터를 같은 위치와 규격으로 케이스에 장착할 수 없습니다.",
          partIds(cooler, computerCase),
          [
            { label: "쿨러 라디에이터", actual: `${radiatorPositionLabel(coolerPosition ?? "확인 필요")} · ${formatNumber(radiatorSize, "mm")}` },
            { label: "케이스 해당 위치 지원", expected: positionSupport ? positionSupport.sizesMm.map((size) => `${size}mm`).join(", ") : "해당 위치 지원 정보 없음" },
            { label: "케이스 전체 위치 지원", expected: radiatorSupports.map((support) => `${radiatorPositionLabel(support.position)}: ${support.sizesMm.map((size) => `${size}mm`).join(", ")}`).join(" · ") }
          ],
          [replaceAction("case"), replaceAction("cooler")]
        );
      } else if (!supportedRadiators.includes(radiatorSize)) {
        addFinding(
          findings,
          "case-radiator-support",
          "blocker",
          "수랭 쿨러의 라디에이터 크기를 케이스가 지원하지 않습니다.",
          "선택한 라디에이터를 케이스에 장착할 수 있는 위치나 규격이 없습니다.",
          partIds(cooler, computerCase),
          [
            { label: "라디에이터 크기", actual: formatNumber(radiatorSize, "mm") },
            { label: "케이스 지원 크기", expected: supportedRadiators.map((size) => `${size}mm`).join(", ") }
          ],
          [replaceAction("case"), replaceAction("cooler")]
        );
      }
    }
  }

  if (!gpu) {
    if (!build.useIntegratedGraphics) {
      addFinding(
        findings,
        "display-output",
        "blocker",
        "그래픽카드 또는 내장 그래픽 사용 설정이 필요합니다.",
        "외장 그래픽카드를 선택하지 않았고 CPU 내장 그래픽 사용도 선택하지 않았습니다.",
        cpu ? [cpu.id] : [],
        [],
        [replaceAction("gpu"), action("verify_spec", "CPU 내장 그래픽 사용")]
      );
    } else if (cpu && cpu.specs.integratedGraphics === false) {
      addFinding(
        findings,
        "display-output",
        "blocker",
        "선택한 CPU에는 내장 그래픽이 없습니다.",
        "외장 그래픽카드가 없으므로 화면을 출력할 수 없습니다. 내장 그래픽 CPU 또는 그래픽카드를 선택하세요.",
        [cpu.id],
        [{ label: "CPU 내장 그래픽", actual: "없음" }],
        [replaceAction("gpu"), replaceAction("cpu")]
      );
    } else if (cpu && cpu.specs.integratedGraphics === undefined) {
      addUnknown(
        findings,
        "display-output",
        "CPU의 내장 그래픽 정보를 확인할 수 없습니다.",
        "외장 그래픽카드가 없는 구성이라 CPU의 화면 출력 지원 여부를 확인해야 합니다.",
        [cpu.id],
        ["integrated graphics"],
        "gpu"
      );
    }
  }

  if (gpu && computerCase) {
    const gpuLength = gpu.specs.lengthMm;
    const maxGpuLength = computerCase.specs.maxGpuLengthMm;
    if (gpuLength === undefined || maxGpuLength === undefined) {
      addUnknown(
        findings,
        "gpu-case-length",
        "그래픽카드와 케이스의 길이 정보를 확인할 수 없습니다.",
        "그래픽카드가 케이스에 들어가는지 확정할 수 없습니다.",
        partIds(gpu, computerCase),
        ["GPU length", "maximum GPU length"],
        "case"
      );
    } else if (gpuLength > maxGpuLength) {
      addFinding(
        findings,
        "gpu-case-length",
        "blocker",
        "그래픽카드 길이가 케이스 허용 길이를 초과합니다.",
        "선택한 그래픽카드를 케이스 안에 장착할 공간이 부족합니다.",
        partIds(gpu, computerCase),
        [
          { label: "그래픽카드 길이", actual: formatNumber(gpuLength, "mm") },
          { label: "케이스 허용 길이", expected: formatNumber(maxGpuLength, "mm") }
        ],
        [replaceAction("case"), replaceAction("gpu")]
      );
    }
    const gpuThickness = gpu.specs.thicknessMm;
    if (gpuThickness === undefined) {
      addUnknown(
        findings,
        "gpu-thickness",
        "그래픽카드 두께 정보를 확인할 수 없습니다.",
        "그래픽카드 두께 원문이 없어 인접 슬롯·케이스 구조물 간섭 여부를 확정할 수 없습니다.",
        partIds(gpu, computerCase, motherboard),
        ["GPU thickness"],
        "case"
      );
    } else if (gpuThickness >= GPU_THICKNESS_WARNING_MM) {
      addFinding(
        findings,
        "gpu-thickness",
        "warning",
        "그래픽카드 두께가 두꺼워 주변 슬롯 간섭을 확인해야 합니다.",
        "두꺼운 그래픽카드는 메인보드 인접 슬롯이나 케이스 측면·전면 구조물과 간섭할 수 있습니다. 실제 슬롯 점유 수와 케이스 여유를 제조사 원문에서 확인하세요.",
        partIds(gpu, computerCase, motherboard),
        [
          { label: "그래픽카드 두께", actual: formatNumber(gpuThickness, "mm") },
          { label: "주의 기준", expected: formatNumber(GPU_THICKNESS_WARNING_MM, "mm 이상") }
        ],
        [action("verify_spec", "GPU 두께·슬롯 간격 확인", "case")]
      );
    }
    const gpuCableBendClearance = gpu.specs.gpuCableBendClearanceMm;
    const caseSidePanelClearance = computerCase.specs.caseSidePanelClearanceMm;
    if (gpuCableBendClearance !== undefined || caseSidePanelClearance !== undefined) {
      if (gpuCableBendClearance === undefined || caseSidePanelClearance === undefined) {
        addFinding(
          findings,
          "gpu-cable-clearance",
          "unknown",
          "GPU 전원 케이블 측면 여유를 확정할 수 없습니다.",
          "GPU가 요구하는 케이블 굽힘 여유와 케이스 측면 여유 중 하나가 확인되지 않아 전원 케이블 간섭을 확정할 수 없습니다.",
          partIds(gpu, computerCase),
          [
            { label: "GPU 케이블 굽힘 여유", actual: gpuCableBendClearance === undefined ? "확인 필요" : formatNumber(gpuCableBendClearance, "mm") },
            { label: "케이스 측면 케이블 여유", actual: caseSidePanelClearance === undefined ? "확인 필요" : formatNumber(caseSidePanelClearance, "mm") }
          ],
          [action("verify_spec", "GPU·케이스 케이블 여유 확인", "case")]
        );
      } else if (caseSidePanelClearance < gpuCableBendClearance) {
        addFinding(
          findings,
          "gpu-cable-clearance",
          "blocker",
          "GPU 전원 케이블 측면 여유가 부족합니다.",
          "검수된 GPU 케이블 굽힘 요구 여유보다 케이스 측면 공간이 작아 전원 케이블이 측판과 간섭할 수 있습니다.",
          partIds(gpu, computerCase),
          [
            { label: "GPU 케이블 굽힘 여유", expected: formatNumber(gpuCableBendClearance, "mm") },
            { label: "케이스 측면 케이블 여유", actual: formatNumber(caseSidePanelClearance, "mm") },
            { label: "케이블 여유 차이", actual: formatNumber(caseSidePanelClearance - gpuCableBendClearance, "mm") }
          ],
          [replaceAction("case"), replaceAction("gpu")]
        );
      }
    }
  }

  if (psu && computerCase) {
    const psuDepth = psu.specs.psuDepthMm;
    const maxPsuLength = computerCase.specs.maxPsuLengthMm;
    if (psuDepth === undefined || maxPsuLength === undefined) {
      addUnknown(
        findings,
        "psu-case-length",
        "파워서플라이와 케이스의 장착 길이를 확인할 수 없습니다.",
        "파워서플라이 깊이 또는 케이스의 허용 파워 장착 길이 원문이 부족해 물리적 장착 여부를 확정할 수 없습니다.",
        partIds(psu, computerCase),
        [psuDepth === undefined ? "PSU depth" : "", maxPsuLength === undefined ? "case maximum PSU length" : ""].filter(Boolean),
        "case"
      );
    } else if (psuDepth > maxPsuLength) {
      addFinding(
        findings,
        "psu-case-length",
        "blocker",
        "파워서플라이 깊이가 케이스 허용 길이를 초과합니다.",
        "선택한 파워서플라이가 케이스의 파워 장착 공간보다 길어 장착 간섭이 발생할 수 있습니다.",
        partIds(psu, computerCase),
        [
          { label: "파워서플라이 깊이", actual: formatNumber(psuDepth, "mm") },
          { label: "케이스 허용 파워 길이", expected: formatNumber(maxPsuLength, "mm") }
        ],
        [replaceAction("psu"), replaceAction("case")]
      );
    }

    const psuFormFactor = psu.specs.psuFormFactor;
    const supportedPsuFormFactors = computerCase.specs.supportedPsuFormFactors;
    if (!psuFormFactor || !supportedPsuFormFactors || supportedPsuFormFactors.length === 0) {
      addUnknown(
        findings,
        "psu-case-form-factor",
        "파워서플라이와 케이스의 규격 정보를 확인할 수 없습니다.",
        "파워서플라이 규격 또는 케이스가 지원하는 파워 규격 원문이 부족해 호환 여부를 확정할 수 없습니다.",
        partIds(psu, computerCase),
        [!psuFormFactor ? "PSU form factor" : "", !supportedPsuFormFactors || supportedPsuFormFactors.length === 0 ? "case supported PSU form factors" : ""].filter(Boolean),
        "case"
      );
    } else if (!supportedPsuFormFactors.includes(psuFormFactor)) {
      addFinding(
        findings,
        "psu-case-form-factor",
        "blocker",
        "파워서플라이 규격이 케이스와 맞지 않습니다.",
        "선택한 파워서플라이의 ATX/SFX 규격을 케이스가 지원하지 않습니다.",
        partIds(psu, computerCase),
        [
          { label: "파워서플라이 규격", actual: psuFormFactor },
          { label: "케이스 지원 파워 규격", expected: supportedPsuFormFactors.join(", ") }
        ],
        [replaceAction("psu"), replaceAction("case")]
      );
    }
  }

  if (gpu && psu) {
    const gpuPower = gpu.specs.powerW;
    const cpuPower = cpu?.specs.pptW ?? cpu?.specs.tdpW ?? 0;
    const psuWattage = psu.specs.wattageW;
    const recommendedPsu = gpu.specs.recommendedPsuW ?? (gpuPower === undefined ? undefined : gpuPower + cpuPower + 150);
    if (gpuPower === undefined || psuWattage === undefined || recommendedPsu === undefined) {
      addUnknown(
        findings,
        "gpu-psu-power",
        "그래픽카드와 파워서플라이 전력 정보를 확인할 수 없습니다.",
        "전력 공급 여유를 확정할 수 없습니다.",
        partIds(gpu, psu, cpu),
        ["GPU power", "recommended PSU wattage", "PSU wattage"],
        "psu"
      );
    } else if (psuWattage < recommendedPsu) {
      addFinding(
        findings,
        "gpu-psu-power",
        "blocker",
        "파워서플라이 용량이 부족합니다.",
        "그래픽카드와 시스템의 권장 전력보다 낮은 파워서플라이가 선택되었습니다.",
        partIds(gpu, psu, cpu),
        [
          { label: "그래픽카드 소비전력", actual: formatNumber(gpuPower, "W") },
          { label: "권장 파워 용량", expected: formatNumber(recommendedPsu, "W") },
          { label: "선택한 파워 용량", actual: formatNumber(psuWattage, "W") }
        ],
        [replaceAction("psu"), replaceAction("gpu")]
      );
    }

    const gpuPowerOptions = gpu.specs.pciePowerOptions;
    const psuPowerConnectors = psu.specs.pciePowerConnectors;
    if (gpuPowerOptions?.length === 0) {
      // The GPU explicitly declares that it has no auxiliary PCIe power requirement.
    } else if (!gpuPowerOptions && !psuPowerConnectors) {
      addUnknown(
        findings,
        "gpu-psu-connector",
        "그래픽카드와 파워서플라이 보조전원 정보를 확인할 수 없습니다.",
        "보조전원 커넥터 원문이 양쪽 모두 부족해 케이블 연결 가능 여부를 확정할 수 없습니다.",
        partIds(gpu, psu),
        ["GPU PCIe power connector", "PSU PCIe power connectors"],
        "psu"
      );
    } else if (!gpuPowerOptions) {
        addUnknown(
          findings,
          "gpu-psu-connector",
          "그래픽카드 보조전원 정보를 확인할 수 없습니다.",
          "파워서플라이 커넥터 정보는 확인됐지만 그래픽카드가 요구하는 PCIe 보조전원 규격 원문이 부족합니다.",
          partIds(gpu, psu),
          ["GPU PCIe power connector"],
          "gpu"
        );
      } else if (!psuPowerConnectors) {
        addUnknown(
          findings,
          "gpu-psu-connector",
          "파워서플라이 보조전원 정보를 확인할 수 없습니다.",
          "그래픽카드가 요구하는 PCIe 보조전원은 확인됐지만 파워서플라이의 제공 커넥터 원문이 부족합니다.",
          partIds(gpu, psu),
          ["PSU PCIe power connectors"],
          "psu"
        );
      } else {
        const connectorStatus = pciePowerMatchFor(gpuPowerOptions, psuPowerConnectors).status;
        if (connectorStatus === "unknown") {
          addFinding(
            findings,
            "gpu-psu-connector",
            "unknown",
            "그래픽카드와 파워서플라이 보조전원 연결을 확정할 수 없습니다.",
            "일부 커넥터 규격 또는 어댑터 경로가 확인되지 않아 실제 연결 가능 여부를 제조사 원문에서 확인해야 합니다.",
            partIds(gpu, psu),
            [
              { label: "GPU 요구 전원", actual: formatPciePowerOptions(gpuPowerOptions) },
              { label: "PSU 확인 커넥터", actual: formatPciePowerConnectors(psuPowerConnectors) }
            ],
            [action("verify_spec", "보조전원 커넥터 원문 확인", "psu")]
          );
        } else if (connectorStatus === "blocker") {
          addFinding(
            findings,
            "gpu-psu-connector",
            "blocker",
            "파워서플라이의 그래픽카드 보조전원 커넥터가 부족합니다.",
            "그래픽카드가 요구하는 PCIe 보조전원 규격과 수량을 파워서플라이에서 확인된 커넥터만으로 충족할 수 없습니다.",
            partIds(gpu, psu),
            [
              { label: "GPU 요구 전원", actual: formatPciePowerOptions(gpuPowerOptions) },
              { label: "PSU 확인 커넥터", expected: formatPciePowerConnectors(psuPowerConnectors) }
            ],
            [replaceAction("psu"), replaceAction("gpu")]
          );
        }
      }
      const pcieCableRuns = psu.specs.psuIndependentPcieCableRuns;
      const pcieCableTopology = psu.specs.psuPcieCableTopology;
      if ((pcieCableRuns !== undefined || pcieCableTopology !== undefined) && gpuPowerOptions && psuPowerConnectors) {
        const connectorMatch = pciePowerMatchFor(gpuPowerOptions, psuPowerConnectors);
        if (connectorMatch.status === "compatible" && connectorMatch.matchedOptionIndex !== undefined) {
          const requiredEightPinCount = pcieEightPinRequirementCount(gpuPowerOptions[connectorMatch.matchedOptionIndex] ?? []);
          const sharedMultiConnectorPath = pcieCableTopology === "shared" && requiredEightPinCount > 1;
          const independentRunsInsufficient = pcieCableRuns === undefined || pcieCableRuns < requiredEightPinCount;
          if (requiredEightPinCount > 0 && (sharedMultiConnectorPath || independentRunsInsufficient)) {
            addFinding(
              findings,
              "gpu-psu-cable-topology",
              "warning",
              "PSU PCIe 케이블 분배 구조를 확인해야 합니다.",
              "커넥터 수량은 충족하지만 여러 8핀 커넥터를 독립 케이블로 연결할 수 있는지 또는 분배 케이블 사용이 제조사 조건에 맞는지 추가 확인이 필요합니다.",
              partIds(gpu, psu),
              [
                { label: "충족한 GPU 연결 선택지", actual: formatPciePowerRequirements(gpuPowerOptions[connectorMatch.matchedOptionIndex] ?? []) },
                { label: "필요한 8핀 커넥터", actual: `${requiredEightPinCount}개` },
                { label: "검수된 독립 PCIe 케이블 런", actual: pcieCableRuns === undefined ? "확인 필요" : `${pcieCableRuns}개` },
                { label: "검수된 분배 구조", actual: pcieCableTopology === "shared" ? "분배·공유 케이블" : pcieCableTopology === "independent" ? "독립 케이블" : "확인 필요" }
              ],
              [action("verify_spec", "PSU PCIe 케이블 연결 방식 확인", "psu"), replaceAction("psu")]
            );
          }
        }
      }
  }

  if (psu && (psu.dataQuality === "incomplete" || psu.missingFields.length > 0)) {
    addFinding(
      findings,
      "psu-data-quality",
      "warning",
      "파워서플라이의 일부 스펙을 확인할 수 없습니다.",
      "현재 데이터만으로는 전력 공급 안정성을 완전히 검증할 수 없습니다. 제조사 공식 스펙을 확인해 주세요.",
      [psu.id],
      psu.missingFields.map((field) => ({ label: "확인되지 않은 항목", actual: field })),
      [action("verify_spec", "파워서플라이 스펙 확인", "psu"), replaceAction("psu")]
    );
  }

  const orderedFindings = findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const blockerCount = orderedFindings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = orderedFindings.filter((finding) => finding.severity === "warning").length;
  const unknownCount = orderedFindings.filter((finding) => finding.severity === "unknown").length;
  const compatibilityLinks = buildCompatibilityLinks(orderedFindings, {
    cpu,
    motherboard,
    memory,
    ssds,
    hdds,
    computerCase,
    cooler,
    gpu,
    psu
  });
  const priceInfo = buildPriceInfo(catalog, build);
  const analysisProfile = options.recommendationPreferences?.profile ?? "general";
  const analysisResolution = options.recommendationPreferences?.gamingResolution ?? DEFAULT_GAMING_RESOLUTION;
  const analysisRefreshRate = options.recommendationPreferences?.gamingRefreshRate ?? DEFAULT_GAMING_REFRESH_RATE;
  const analysis = options.includeSuggestions !== false || options.includeAnalysis === true
    ? analyzeBuild(build, catalog, metrics, orderedFindings, analysisProfile, analysisResolution, analysisRefreshRate)
    : emptyBuildAnalysis(analysisProfile);
  const result: CompatibilityResult = {
    status: blockerCount > 0 ? "incompatible" : unknownCount > 0 ? "needs_review" : "compatible",
    blockerCount,
    warningCount,
    unknownCount,
    findings: orderedFindings,
    metrics,
    analysis,
    gpuFit: gpuFitSummaryFor(metrics, gpu, computerCase, psu, orderedFindings),
    links: compatibilityLinks,
    totalPriceWon: priceInfo.total,
    priceComplete: priceInfo.complete,
    engineVersion: ENGINE_VERSION,
    catalogSnapshotAt: options.catalogSnapshotAt ?? new Date().toISOString(),
    checkedAt: new Date().toISOString()
  };

  if (options.includeSuggestions !== false) {
    result.recommendationPreferences = options.recommendationPreferences;
    result.repairPlans = buildRepairPlans(result, build, catalog, options.recommendationPreferences, evaluationCache, recommendationSearchContext);
    attachSuggestions(result, build, catalog, evaluationCache, recommendationSearchContext);
    const upgradeRecommendations = buildUpgradeRecommendations(
      build,
      catalog,
      options.recommendationPreferences?.profile ?? "general",
      options.recommendationPreferences?.listingPolicy ?? "retail_only",
      options.recommendationPreferences?.priority ?? "balanced",
      analysisResolution,
      options.recommendationPreferences?.budgetWon,
      evaluationCache,
      {},
      analysisRefreshRate
    );
    if (upgradeRecommendations.length > 0) result.upgradeRecommendations = upgradeRecommendations;
    const bundleCandidateRecommendations = buildUpgradeRecommendations(
      build,
      catalog,
      options.recommendationPreferences?.profile ?? "general",
      options.recommendationPreferences?.listingPolicy ?? "retail_only",
      options.recommendationPreferences?.priority ?? "balanced",
      analysisResolution,
      options.recommendationPreferences?.budgetWon,
      evaluationCache,
      { maxPerCategory: BUNDLE_CANDIDATE_MAX_PER_CATEGORY, maxTotal: BUNDLE_CANDIDATE_MAX_TOTAL },
      analysisRefreshRate
    );
    const upgradeBundleSearch = buildUpgradeBundlesWithSummary(
      build,
      catalog,
      bundleCandidateRecommendations,
      options.recommendationPreferences?.priority ?? "balanced",
      options.recommendationPreferences?.budgetWon,
      evaluationCache
    );
    if (upgradeBundleSearch.bundles.length > 0) result.upgradeBundles = upgradeBundleSearch.bundles;
    if (upgradeBundleSearch.summary.candidatePairCount > 0) result.upgradeBundleSearch = upgradeBundleSearch.summary;
    if (recommendationSearchContext.candidateSetCount > 0) {
      result.recommendationSearch = recommendationSearchSummaryFor(recommendationSearchContext);
    }
  }
  if (cacheKey) {
    if (!evaluationCache.has(cacheKey) && evaluationCache.size >= MAX_EVALUATION_CACHE_ENTRIES) {
      const oldestKey = evaluationCache.keys().next().value;
      if (oldestKey !== undefined) evaluationCache.delete(oldestKey);
    }
    evaluationCache.set(cacheKey, result);
  }
  return result;
}

const GENERATOR_REQUIRED_FIELDS: Partial<Record<PartCategory, string[]>> = {
  cpu: ["socket", "memoryType", "tdpW"],
  motherboard: ["socket", "memoryType", "maxMemoryGb", "memorySlots", "maxMemorySpeedMhz", "m2Slots", "sataPorts", "formFactor", "vrmCapacityW"],
  memory: ["memoryType", "capacityGb", "speedMhz", "formFactor"],
  cooler: ["supportedSockets", "maxCoolingW", "maxCoolerHeightMm"],
  gpu: ["powerW", "recommendedPsuW", "lengthMm"],
  ssd: ["interface", "formFactor", "capacityGb"],
  hdd: ["interface", "formFactor", "capacityGb"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays", "motherboardFormFactors"],
  psu: ["wattageW"]
};

const GENERATOR_CATEGORY_WEIGHTS: Record<RecommendationProfile, Partial<Record<PartCategory, number>>> = {
  general: { cpu: 3, gpu: 4, motherboard: 2, memory: 2, ssd: 2, cooler: 1, case: 1, psu: 1 },
  gaming: { cpu: 4, gpu: 7, motherboard: 1, memory: 3, ssd: 1, cooler: 1, case: 1, psu: 1 },
  creator: { cpu: 6, gpu: 3, motherboard: 1, memory: 5, ssd: 4, cooler: 1, case: 1, psu: 1 },
  development: { cpu: 5, gpu: 2, motherboard: 1, memory: 5, ssd: 4, cooler: 1, case: 1, psu: 1 },
  office: { cpu: 3, gpu: 1, motherboard: 2, memory: 3, ssd: 3, cooler: 1, case: 1, psu: 1 }
};

type GeneratorState = {
  selection: BuildSelection;
  parts: Partial<Record<PartCategory, Part>>;
  priceWon: number;
  capabilityScore: number;
};

function generatorHasFields(part: Part, fields: string[]) {
  return fields.every((field) => {
    const value = part.specs[field as keyof typeof part.specs];
    return value !== undefined && (!Array.isArray(value) || value.length > 0);
  });
}

function generatorCapabilityScores(parts: Part[], profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  const valuesByKey = new Map<string, number[]>();
  for (const part of parts) {
    for (const [key, value] of Object.entries(performanceDimensions(part))) {
      if (typeof value !== "number") continue;
      const values = valuesByKey.get(key) ?? [];
      values.push(value);
      valuesByKey.set(key, values);
    }
  }
  for (const values of valuesByKey.values()) values.sort((a, b) => a - b);

  const scores = new Map<string, number>();
  for (const part of parts) {
    const weights = performanceWeightsFor(part.category, profile, gamingResolution, gamingRefreshRate);
    let weighted = 0;
    let totalWeight = 0;
    for (const [key, value] of Object.entries(performanceDimensions(part))) {
      if (typeof value !== "number") continue;
      const peers = valuesByKey.get(key) ?? [];
      if (peers.length === 0) continue;
      const rank = peers.length === 1
        ? 100
        : ((peers.filter((peer) => performanceDimensionHigherIsBetter(key) ? peer <= value : peer >= value).length - 1) / (peers.length - 1)) * 100;
      const weight = weights[key] ?? 1;
      weighted += rank * weight;
      totalWeight += weight;
    }
    if (profile === "gaming" && part.category === "gpu") {
      const targetScore = gpuTargetScoreFor(part, gamingResolution) ?? 50;
      const targetWeight = 5;
      weighted += targetScore * targetWeight;
      totalWeight += targetWeight;
    }
    scores.set(part.id, totalWeight > 0 ? Math.max(0, Math.min(100, Math.round(weighted / totalWeight))) : 50);
  }
  return scores;
}

function hasNumericPerformanceDimension(part: Part) {
  return Object.values(performanceDimensions(part)).some((value) => typeof value === "number");
}

function catalogRelativeScores(catalog: Part[], category: PartCategory, profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  const peers = catalog.filter((candidate) => candidate.category === category && candidate.dataQuality !== "incomplete" && hasNumericPerformanceDimension(candidate));
  return generatorCapabilityScores(peers, profile, gamingResolution, gamingRefreshRate);
}

function buildAnalysisBalanceFor(cpuScore: number | undefined, gpuScore: number | undefined): BuildAnalysisBalance | undefined {
  if (cpuScore === undefined || gpuScore === undefined) return undefined;
  const difference = gpuScore - cpuScore;
  const gap = Math.abs(difference);
  if (gap < 20) {
    return {
      cpuScore,
      gpuScore,
      gap,
      status: "balanced",
      summary: `카탈로그 상대 지수 기준 CPU ${cpuScore}점 · GPU ${gpuScore}점으로 차이가 ${gap}점입니다. 큰 한쪽 쏠림 없이 균형 범위로 봅니다.`
    };
  }
  if (difference > 0) {
    return {
      cpuScore,
      gpuScore,
      gap,
      status: "cpu_limited",
      summary: `카탈로그 상대 지수에서 GPU ${gpuScore}점이 CPU ${cpuScore}점보다 ${gap}점 높습니다. 작업·게임에 따라 CPU 쪽을 먼저 비교할 여지가 있습니다.`
    };
  }
  return {
    cpuScore,
    gpuScore,
    gap,
    status: "gpu_limited",
    summary: `카탈로그 상대 지수에서 CPU ${cpuScore}점이 GPU ${gpuScore}점보다 ${gap}점 높습니다. 고해상도·그래픽 작업에 따라 GPU 쪽을 먼저 비교할 여지가 있습니다.`
  };
}

function buildAnalysisInsightsFor(factors: BuildAnalysisFactor[], profile: RecommendationProfile) {
  const scored = factors.filter((factor): factor is BuildAnalysisFactor & { score: number } => factor.score !== undefined);
  const toInsight = (factor: BuildAnalysisFactor & { score: number }, kind: "strength" | "focus"): BuildAnalysisInsight => ({
    category: factor.category,
    score: factor.score,
    title: kind === "strength" ? `${CATEGORY_LABELS[factor.category]} 강점` : `${CATEGORY_LABELS[factor.category]} 보완`,
    summary: kind === "strength"
      ? `${RECOMMENDATION_PROFILE_LABELS[profile]} 기준에서 확인 스펙 상대 지수 ${factor.score}점으로 강점입니다.`
      : `${RECOMMENDATION_PROFILE_LABELS[profile]} 기준에서 확인 스펙 상대 지수 ${factor.score}점으로 먼저 비교할 영역입니다.`
  });
  const strengths = [...scored]
    .filter((factor) => factor.score >= 75)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((factor) => toInsight(factor, "strength"));
  const focusCandidates = [...scored]
    .filter((factor) => factor.score < 60)
    .sort((left, right) => left.score - right.score);
  const focusAreas = (focusCandidates.length > 0 ? focusCandidates : [...scored].sort((left, right) => left.score - right.score).filter((factor) => factor.score < 75).slice(0, 1))
    .slice(0, 2)
    .map((factor) => toInsight(factor, "focus"));
  return { strengths, focusAreas };
}

function analyzeBuild(
  build: BuildSelection,
  catalog: Part[],
  metrics: BuildMetrics,
  findings: Finding[],
  profile: RecommendationProfile,
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
): BuildAnalysis {
  const factors: BuildAnalysisFactor[] = [];
  const scoreMaps = new Map<PartCategory, Map<string, number>>();
  for (const category of PART_CATEGORIES) {
    const entries = categorySelections(build, category)
      .map((selection) => ({ selection, part: selectedPart(catalog, selection) }))
      .filter((entry): entry is { selection: PartSelection; part: Part } => Boolean(entry.part));
    if (entries.length === 0) continue;
    const scoreMap = scoreMaps.get(category) ?? catalogRelativeScores(catalog, category, profile, gamingResolution, gamingRefreshRate);
    scoreMaps.set(category, scoreMap);
    const scored = entries
      .map(({ selection, part }) => ({ score: part.dataQuality === "incomplete" ? undefined : scoreMap.get(part.id), quantity: selection.quantity }))
      .filter((entry): entry is { score: number; quantity: number } => entry.score !== undefined);
    const score = scored.length > 0
      ? Math.round(scored.reduce((total, entry) => total + entry.score * entry.quantity, 0) / scored.reduce((total, entry) => total + entry.quantity, 0))
      : undefined;
    const weight = GENERATOR_CATEGORY_WEIGHTS[profile][category] ?? 1;
    factors.push({
      category,
      label: CATEGORY_LABELS[category],
      score,
      weight,
      basis: score === undefined
        ? "비교 가능한 확인 스펙이 부족합니다."
        : `현재 카탈로그 확인 스펙의 상대 지수 ${score}점${entries.length > 1 ? " · 선택 수량 반영" : ""}`
    });
  }

  const scoredFactors = factors.filter((factor): factor is BuildAnalysisFactor & { score: number } => factor.score !== undefined);
  const totalWeight = scoredFactors.reduce((total, factor) => total + factor.weight, 0);
  const overallScore = totalWeight > 0
    ? Math.round(scoredFactors.reduce((total, factor) => total + factor.score * factor.weight, 0) / totalWeight)
    : undefined;
  const scoreLabel: BuildAnalysis["scoreLabel"] = overallScore === undefined
    ? "계산 불가"
    : overallScore >= 80
      ? "상위권"
      : overallScore >= 60
        ? "균형형"
        : "보완 권장";
  const confidence: BuildAnalysis["confidence"] = scoredFactors.length === 0
    ? "unknown"
    : scoredFactors.length >= 4 && scoredFactors.length === factors.length
      ? "high"
      : "limited";
  const cpuScore = factors.find((factor) => factor.category === "cpu")?.score;
  const gpuScore = factors.find((factor) => factor.category === "gpu")?.score;
  const balance = buildAnalysisBalanceFor(cpuScore, gpuScore);
  const { strengths, focusAreas } = buildAnalysisInsightsFor(factors, profile);
  const currentGpu = currentCategoryPart(catalog, build, "gpu");
  const gpuTarget = profile === "gaming" && currentGpu
    ? gpuTargetEvidenceFor(currentGpu, undefined, gamingResolution, gamingRefreshRate)
    : undefined;

  const bottlenecks: BuildBottleneck[] = findings
    .filter((finding) => finding.severity === "blocker" || finding.severity === "warning" || finding.severity === "unknown")
    .map((finding) => ({
      id: `finding-${finding.id}`,
      severity: finding.severity === "blocker" ? "critical" : finding.severity === "warning" ? "warning" : "info",
      category: finding.actions.find((item) => item.targetCategory)?.targetCategory,
      title: finding.title,
      message: finding.message,
      actual: finding.facts.find((fact) => fact.actual)?.actual,
      limit: finding.facts.find((fact) => fact.expected)?.expected,
      action: finding.actions[0]?.label
    }));
  const hasRule = (ruleId: string) => findings.some((finding) => finding.ruleId === ruleId && finding.severity !== "info");
  const addSignal = (signal: BuildBottleneck) => {
    if (!bottlenecks.some((item) => item.id === signal.id)) bottlenecks.push(signal);
  };

  if (gpuTarget?.currentFit === "partial") {
    addSignal({
      id: "gpu-target-vram",
      severity: "warning",
      category: "gpu",
      title: "선택한 해상도의 권장 VRAM에 도달하지 않았습니다.",
      message: "호환성은 별도로 통과했지만 게임 옵션·텍스처 설정에 따라 선택한 해상도에서 VRAM 여유가 부족할 수 있습니다.",
      actual: `현재 ${formatTargetVram(gpuTarget.currentVramGb)}`,
      limit: `${GAMING_RESOLUTION_LABELS[gpuTarget.resolution]} 권장 ${gpuTarget.targetVramGb}GB`,
      action: "권장 VRAM을 충족하는 GPU 후보 비교"
    });
  }
  if (gpuTarget?.currentFit === "unknown") {
    addSignal({
      id: "gpu-target-vram-unknown",
      severity: "info",
      category: "gpu",
      title: "선택한 해상도의 GPU VRAM을 확인해야 합니다.",
      message: "카탈로그에 VRAM이 없어 해상도별 권장 기준 충족 여부를 확정하지 않습니다.",
      actual: "현재 VRAM 확인 불가",
      limit: `${GAMING_RESOLUTION_LABELS[gpuTarget.resolution]} 권장 ${gpuTarget.targetVramGb}GB`,
      action: "GPU 제조사 원문에서 VRAM 확인"
    });
  }

  if (metrics.powerHeadroomW !== undefined && metrics.powerHeadroomW < 120 && !hasRule("gpu-psu-power")) {
    addSignal({
      id: "power-headroom",
      severity: metrics.powerHeadroomW < 0 ? "critical" : "warning",
      category: "psu",
      title: "파워 여유가 좁습니다.",
      message: "호환 기준은 통과했지만 부하 변동과 향후 업그레이드를 고려할 여유가 작습니다.",
      actual: `${metrics.powerHeadroomW}W 여유`,
      limit: "120W 이상 권장",
      action: "더 여유 있는 파워 비교"
    });
  }
  if (metrics.memoryHeadroomGb !== undefined && metrics.memoryHeadroomGb <= 0 && !hasRule("memory-capacity")) {
    addSignal({
      id: "memory-capacity-headroom",
      severity: metrics.memoryHeadroomGb < 0 ? "critical" : "info",
      category: "memory",
      title: "메모리 용량 확장 여유가 없습니다.",
      message: "현재 용량은 장착되지만 메인보드 확인 한도에 도달했습니다.",
      actual: `${metrics.totalMemoryGb ?? "?"}GB 사용`,
      limit: `${metrics.memoryHeadroomGb === 0 ? "추가 여유 없음" : `${Math.abs(metrics.memoryHeadroomGb)}GB 초과`}`,
      action: "메모리 확장 계획 확인"
    });
  }
  if (metrics.memorySlotHeadroom !== undefined && metrics.memorySlotHeadroom <= 0 && !hasRule("memory-slots")) {
    addSignal({
      id: "memory-slot-headroom",
      severity: "info",
      category: "memory",
      title: "RAM 슬롯을 모두 사용하고 있습니다.",
      message: "추후 증설할 때 기존 모듈을 교체해야 할 수 있습니다.",
      actual: `${metrics.memorySlotsUsed ?? "?"}개 사용`,
      limit: "추가 슬롯 없음",
      action: "메모리 증설 계획 확인"
    });
  }
  if (metrics.m2Headroom !== undefined && metrics.m2Headroom <= 0 && !hasRule("m2-slots")) {
    addSignal({
      id: "m2-headroom",
      severity: "info",
      category: "motherboard",
      title: "M.2 슬롯을 모두 사용하고 있습니다.",
      message: "추가 NVMe SSD를 장착하려면 PCIe 확장 카드나 기존 장치 교체가 필요할 수 있습니다.",
      actual: `${metrics.m2Used ?? "?"}개 사용`,
      limit: "추가 M.2 슬롯 없음",
      action: "저장장치 확장 계획 확인"
    });
  }
  if (metrics.sataHeadroom !== undefined && metrics.sataHeadroom <= 0 && !hasRule("sata-ports")) {
    addSignal({
      id: "sata-headroom",
      severity: "info",
      category: "motherboard",
      title: "SATA 포트를 모두 사용하고 있습니다.",
      message: "추가 SATA SSD·HDD를 연결할 포트 여유가 없습니다.",
      actual: `${metrics.sataUsed ?? "?"}개 사용`,
      limit: "추가 SATA 포트 없음",
      action: "저장장치 확장 계획 확인"
    });
  }
  if (metrics.hddBayHeadroom !== undefined && metrics.hddBayHeadroom <= 0 && !hasRule("case-hdd-bays")) {
    addSignal({
      id: "hdd-bay-headroom",
      severity: "info",
      category: "case",
      title: "케이스 HDD 베이를 모두 사용하고 있습니다.",
      message: "추가 3.5인치 HDD를 장착할 공간이 없습니다.",
      actual: `${metrics.hddUsed ?? "?"}개 사용`,
      limit: "추가 HDD 베이 없음",
      action: "케이스 확장성 확인"
    });
  }
  if (metrics.gpuClearanceMm !== undefined && metrics.gpuClearanceMm < 30 && !hasRule("gpu-case-length")) {
    addSignal({
      id: "gpu-clearance",
      severity: metrics.gpuClearanceMm < 0 ? "critical" : "warning",
      category: "case",
      title: "그래픽카드 길이 여유가 좁습니다.",
      message: "현재는 장착 범위를 통과하지만 전면 팬·라디에이터와 간섭할 여지를 확인해야 합니다.",
      actual: `${metrics.gpuClearanceMm}mm 여유`,
      limit: "30mm 이상 권장",
      action: "케이스 내부 간섭 확인"
    });
  }
  if (metrics.coolerClearanceMm !== undefined && metrics.coolerClearanceMm < 10 && !hasRule("case-cooler-height")) {
    addSignal({
      id: "cooler-clearance",
      severity: metrics.coolerClearanceMm < 0 ? "critical" : "warning",
      category: "case",
      title: "CPU 쿨러 높이 여유가 좁습니다.",
      message: "측판이나 튜닝 부품과의 실제 간섭 가능성을 확인해야 합니다.",
      actual: `${metrics.coolerClearanceMm}mm 여유`,
      limit: "10mm 이상 권장",
      action: "쿨러·케이스 간섭 확인"
    });
  }
  if (metrics.coolerHeadroomW !== undefined && metrics.coolerHeadroomW < 50 && !hasRule("cpu-cooler-capacity")) {
    addSignal({
      id: "cooler-capacity-headroom",
      severity: metrics.coolerHeadroomW < 0 ? "critical" : "warning",
      category: "cooler",
      title: "CPU 쿨러 냉각 여유가 좁습니다.",
      message: "호환 기준은 통과했지만 고부하 환경에서 온도·소음 여유가 작을 수 있습니다.",
      actual: `${metrics.coolerHeadroomW}W 여유`,
      limit: "50W 이상 권장",
      action: "상위 냉각 성능 쿨러 비교"
    });
  }

  const sortedBottlenecks = bottlenecks.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]));
  const nextActions = [...sortedBottlenecks.map((item) => item.action).filter((item): item is string => Boolean(item))];
  if (balance?.status === "cpu_limited") nextActions.push("CPU·GPU 상대 지수 차이를 확인하고 CPU 업그레이드 후보를 먼저 비교해 보세요.");
  if (balance?.status === "gpu_limited") nextActions.push("CPU·GPU 상대 지수 차이를 확인하고 GPU 업그레이드 후보를 먼저 비교해 보세요.");
  for (const factor of factors.filter((item) => item.score !== undefined && item.score < 45)) {
    nextActions.push(`${factor.label}의 카탈로그 상대 지수(${factor.score}점)를 우선 비교해 보세요.`);
  }
  const uniqueActions = [...new Set(nextActions)].slice(0, 4);
  if (uniqueActions.length === 0) uniqueActions.push("현재 확인된 스펙 기준에서 우선 교체할 병목이 없습니다.");
  return {
    profile,
    overallScore,
    scoreLabel,
    scoreBasis: "실제 벤치마크·FPS가 아닌, 현재 카탈로그의 확인된 스펙을 같은 범주 안에서 비교한 상대 지수입니다.",
    confidence,
    factors: factors.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
    ...(balance ? { balance } : {}),
    strengths,
    focusAreas,
    bottlenecks: sortedBottlenecks.slice(0, 8),
    nextActions: uniqueActions,
    ...(gpuTarget ? { gpuTarget } : {})
  };
}

function generatorCandidatePool(
  catalog: Part[],
  category: PartCategory,
  profile: RecommendationProfile,
  predicate: (part: Part) => boolean = () => true,
  listingPolicy: ListingPolicy = "retail_only",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE,
  requiredFields: string[] = GENERATOR_REQUIRED_FIELDS[category] ?? [],
  allowIncomplete = false
) {
  const candidates = catalog
    .filter((part) => part.category === category)
    .filter((part) => part.listingType !== "accessory")
    .filter((part) => allowIncomplete || part.dataQuality !== "incomplete")
    .filter((part) => isKnownPrice(part.priceWon))
    .filter((part) => generatorHasFields(part, requiredFields))
    .filter((part) => isListingAllowed(part, listingPolicy))
    .filter(predicate);
  const scores = generatorCapabilityScores(candidates, profile, gamingResolution, gamingRefreshRate);
  const selected = new Map<string, Part>();
  const priceLimit = category === "cpu" ? 500 : category === "memory" || category === "gpu" ? 120 : 60;
  [...candidates].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || (a.priceWon ?? 0) - (b.priceWon ?? 0)).slice(0, 40).forEach((part) => selected.set(part.id, part));
  [...candidates].sort((a, b) => (a.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.priceWon ?? Number.MAX_SAFE_INTEGER)).slice(0, priceLimit).forEach((part) => selected.set(part.id, part));
  return { parts: [...selected.values()], scores };
}

function generatorStoragePool(catalog: Part[], category: "ssd" | "hdd", profile: RecommendationProfile, requestedCapacityGb: number, listingPolicy: ListingPolicy, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  const preferred = generatorCandidatePool(catalog, category, profile, (part) => {
    const capacity = part.specs.capacityGb;
    return capacity !== undefined && capacity >= requestedCapacityGb && capacity <= requestedCapacityGb * 1.5;
  }, listingPolicy, gamingResolution, gamingRefreshRate);
  return preferred.parts.length > 0 ? preferred : generatorCandidatePool(catalog, category, profile, () => true, listingPolicy, gamingResolution, gamingRefreshRate);
}

function generatorMemoryPool(catalog: Part[], profile: RecommendationProfile, requestedCapacityGb: number, listingPolicy: ListingPolicy, gamingResolution: GamingResolution, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  return generatorCandidatePool(catalog, "memory", profile, (part) => {
    const capacityGb = part.specs.capacityGb;
    if (capacityGb === undefined) return false;
    const kitCapacityGb = capacityGb * 2;
    return kitCapacityGb >= requestedCapacityGb && kitCapacityGb <= requestedCapacityGb * 2;
  }, listingPolicy, gamingResolution, gamingRefreshRate);
}

function generatorCaseRequiredFields(includeGpu: boolean, hddCount: number) {
  return [
    "maxCoolerHeightMm",
    "motherboardFormFactors",
    "maxPsuLengthMm",
    "supportedPsuFormFactors",
    ...(includeGpu ? ["maxGpuLengthMm"] : []),
    ...(hddCount > 0 ? ["hddBays"] : [])
  ];
}

function generatorStateScore(state: GeneratorState, budgetWon: number) {
  const overBudgetRatio = Math.max(0, state.priceWon - budgetWon) / Math.max(budgetWon, 1);
  return state.capabilityScore - overBudgetRatio * 2000 - (state.priceWon / Math.max(budgetWon, 1)) * 8;
}

function pruneGeneratorStates(states: GeneratorState[], budgetWon: number, limit = 160) {
  const unique = new Map<string, GeneratorState>();
  for (const state of states) {
    const key = ["cpu", "gpu", "motherboard", "memory", "cooler", "case", "ssd", "psu"]
      .map((category) => `${category}:${state.parts[category as PartCategory]?.id ?? ""}:${state.selection[category as PartCategory] && !Array.isArray(state.selection[category as PartCategory]) ? (state.selection[category as PartCategory] as PartSelection).quantity : ""}`)
      .join("|");
    const existing = unique.get(key);
    if (!existing || generatorStateScore(state, budgetWon) > generatorStateScore(existing, budgetWon)) unique.set(key, state);
  }
  const sorted = [...unique.values()].sort((a, b) => generatorStateScore(b, budgetWon) - generatorStateScore(a, budgetWon) || a.priceWon - b.priceWon);
  const cheap = [...unique.values()].sort((a, b) => a.priceWon - b.priceWon).slice(0, Math.max(1, Math.floor(limit / 4)));
  const kept = new Map<string, GeneratorState>();
  for (const state of [...cheap, ...sorted]) {
    const key = ["cpu", "gpu", "motherboard", "memory", "cooler", "case", "ssd", "psu"]
      .map((category) => state.parts[category as PartCategory]?.id ?? "")
      .join("|");
    if (!kept.has(key)) kept.set(key, state);
    if (kept.size >= limit) break;
  }
  return [...kept.values()];
}

function addGeneratorPart(state: GeneratorState, category: PartCategory, part: Part, capabilityScore: number, profile: RecommendationProfile, requestedQuantity?: number) {
  const quantity = requestedQuantity ?? (category === "memory" ? 2 : 1);
  const selection = { ...state.selection } as BuildSelection;
  if (category === "memory" || category === "ssd" || category === "hdd") {
    selection[category] = [{ partId: part.id, quantity }];
  } else {
    selection[category] = { partId: part.id, quantity };
  }
  return {
    selection,
    parts: { ...state.parts, [category]: part },
    priceWon: state.priceWon + (part.priceWon ?? 0) * quantity,
    capabilityScore: state.capabilityScore + capabilityScore * (GENERATOR_CATEGORY_WEIGHTS[profile][category] ?? 1)
  };
}

function expandGeneratorStates(
  states: GeneratorState[],
  category: PartCategory,
  candidatesForState: (state: GeneratorState) => Part[],
  scores: Map<string, number>,
  profile: RecommendationProfile,
  budgetWon: number,
  quantity?: number,
  pruneLimit = 160
) {
  const expanded: GeneratorState[] = [];
  for (const state of states) {
    for (const part of candidatesForState(state)) {
      expanded.push(addGeneratorPart(state, category, part, scores.get(part.id) ?? 50, profile, quantity));
    }
  }
  return pruneGeneratorStates(expanded, budgetWon, pruneLimit);
}

function requireGeneratorStates(states: GeneratorState[], message: string, diagnostics: BuildGenerationDiagnostic[] = []) {
  if (states.length === 0) throw diagnostics.length > 0 ? new BuildGenerationError(message, diagnostics) : new Error(message);
  return states;
}

function generatorCpuCanUseMotherboard(cpu: Part, motherboard: Part) {
  const cpuPower = cpu.specs.pptW ?? cpu.specs.tdpW;
  return cpu.specs.socket !== undefined
    && motherboard.specs.socket === cpu.specs.socket
    && motherboard.specs.memoryType === cpu.specs.memoryType
    && cpuPower !== undefined
    && motherboard.specs.vrmCapacityW !== undefined
    && motherboard.specs.vrmCapacityW >= cpuPower;
}

function generatorMemoryCanUseMotherboard(memory: Part, motherboard: Part, cpu?: Part) {
  const profileKnown = (memory.specs.memoryProfiles?.length ?? 0) > 0;
  const confirmedSpeedLimits = [
    motherboard.specs.maxMemorySpeedMhz,
    ...(profileKnown ? [cpu?.specs.maxMemorySpeedMhz] : [])
  ].filter((value): value is number => value !== undefined && value > 0);
  const effectiveSpeedLimit = confirmedSpeedLimits.length > 0 ? Math.min(...confirmedSpeedLimits) : undefined;
  const profileOverlap = !profileKnown
    || (motherboard.specs.memoryProfiles !== undefined
      && memory.specs.memoryProfiles!.some((profile) => motherboard.specs.memoryProfiles!.includes(profile)));
  const physicalModuleCount = (memory.specs.memoryModuleCountPerKit ?? 1) * 2;
  return profileOverlap
    && memory.specs.memoryType === motherboard.specs.memoryType
    && memory.specs.capacityGb !== undefined
    && motherboard.specs.maxMemoryGb !== undefined
    && memory.specs.capacityGb * 2 <= motherboard.specs.maxMemoryGb
    && memory.specs.speedMhz !== undefined
    && effectiveSpeedLimit !== undefined
    && memory.specs.speedMhz <= effectiveSpeedLimit
    && motherboard.specs.memorySlots !== undefined
    && motherboard.specs.memorySlots >= physicalModuleCount;
}

function generatorCoolerCanUseCpu(cooler: Part, cpu: Part) {
  const cpuHeat = cpu.specs.pptW ?? cpu.specs.tdpW;
  return cpu.specs.socket !== undefined
    && cooler.specs.supportedSockets?.includes(cpu.specs.socket) === true
    && cpuHeat !== undefined
    && cooler.specs.maxCoolingW !== undefined
    && cooler.specs.maxCoolingW >= cpuHeat;
}

function generatorCaseCanUseParts(computerCase: Part, motherboard: Part, cooler: Part, gpu: Part | undefined, hddCount: number) {
  return motherboard.specs.formFactor !== undefined
    && computerCase.specs.motherboardFormFactors?.includes(motherboard.specs.formFactor) === true
    && cooler.specs.maxCoolerHeightMm !== undefined
    && computerCase.specs.maxCoolerHeightMm !== undefined
    && cooler.specs.maxCoolerHeightMm <= computerCase.specs.maxCoolerHeightMm
    && (hddCount === 0 || (computerCase.specs.hddBays !== undefined && computerCase.specs.hddBays >= hddCount))
    && (!gpu || (gpu.specs.lengthMm !== undefined && computerCase.specs.maxGpuLengthMm !== undefined && gpu.specs.lengthMm <= computerCase.specs.maxGpuLengthMm));
}

function generatorStorageCanUseMotherboard(storage: Part, motherboard: Part, existingSsd: Part | undefined, hddCount: number) {
  const formFactor = storage.specs.formFactor?.toLowerCase() ?? "";
  const interfaceName = storage.specs.interface?.toLowerCase() ?? "";
  const existingSsdUsesSata = existingSsd?.specs.interface?.toLowerCase().includes("sata") === true;
  const sataUsedBySsd = existingSsdUsesSata ? 1 : 0;
  const motherboardM2PcieGenerations = motherboard.specs.m2PcieGenerations;
  const motherboardMaxM2PcieGeneration = motherboardM2PcieGenerations && motherboardM2PcieGenerations.length > 0
    ? Math.max(...motherboardM2PcieGenerations)
    : undefined;
  const storagePcieGenerationCompatible = !interfaceName.includes("nvme")
    || storage.specs.m2PcieGeneration === undefined
    || motherboardMaxM2PcieGeneration === undefined
    || storage.specs.m2PcieGeneration <= motherboardMaxM2PcieGeneration;
  if (storage.category === "ssd" && formFactor.includes("m.2")) {
    return storagePcieGenerationCompatible
      && (motherboard.specs.m2Slots ?? 0) >= 1
      && (motherboard.specs.sataPorts ?? 0) >= hddCount;
  }
  if (storage.category === "ssd" && interfaceName.includes("sata")) return (motherboard.specs.sataPorts ?? 0) >= hddCount + 1;
  if (storage.category === "hdd" && interfaceName.includes("sata")) return (motherboard.specs.sataPorts ?? 0) >= sataUsedBySsd + hddCount;
  return false;
}

function generatorPsuCanUseGpu(psu: Part, gpu: Part | undefined) {
  if (!gpu) return (psu.specs.wattageW ?? 0) >= 400;
  return gpu.specs.recommendedPsuW !== undefined
    && psu.specs.wattageW !== undefined
    && psu.specs.wattageW >= gpu.specs.recommendedPsuW;
}

function preferBudgetCandidates(parts: Part[], budgetWon: number, share: number, quantity = 1) {
  const budgetCandidates = parts.filter((part) => isKnownPrice(part.priceWon) && part.priceWon * quantity <= budgetWon * share);
  return budgetCandidates.length > 0 ? budgetCandidates : parts;
}

function preferRequestedCapacity(parts: Part[], requestedCapacityGb: number, maximumMultiplier = 2) {
  const nearCandidates = parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb <= requestedCapacityGb * maximumMultiplier);
  return nearCandidates.length > 0 ? nearCandidates : parts;
}

function generatedPartSpecSummary(part: Part) {
  const specs = part.specs;
  const values: Array<string | undefined> = part.category === "cpu"
    ? [specs.socket ? `소켓 ${specs.socket}` : undefined, specs.cores !== undefined && specs.threads !== undefined ? `${specs.cores}코어/${specs.threads}스레드` : undefined, specs.boostClockGhz !== undefined ? `부스트 ${specs.boostClockGhz}GHz` : undefined, specs.cinebenchR23Multi !== undefined ? `R23 멀티 ${specs.cinebenchR23Multi.toLocaleString("ko-KR")}` : undefined]
    : part.category === "cooler"
      ? [specs.supportedSockets && specs.supportedSockets.length > 0 ? `소켓 ${specs.supportedSockets.join("/")}` : undefined, specs.maxCoolingW !== undefined ? `최대 냉각 ${specs.maxCoolingW}W` : undefined, specs.maxCoolerHeightMm !== undefined ? `높이 ${specs.maxCoolerHeightMm}mm` : undefined]
      : part.category === "motherboard"
        ? [specs.socket ? `소켓 ${specs.socket}` : undefined, specs.memoryType, specs.formFactor, specs.m2Slots !== undefined ? `M.2 ${specs.m2Slots}개` : undefined, specs.sataPorts !== undefined ? `SATA ${specs.sataPorts}개` : undefined]
        : part.category === "memory"
          ? [specs.capacityGb !== undefined ? `${specs.capacityGb}GB/킷` : undefined, specs.speedMhz !== undefined ? `${specs.speedMhz}MHz` : undefined, specs.memoryCasLatency !== undefined ? `CL${specs.memoryCasLatency}` : undefined, specs.formFactor]
          : part.category === "gpu"
            ? [specs.vramGb !== undefined ? `VRAM ${specs.vramGb}GB` : undefined, specs.powerW !== undefined ? `소비 ${specs.powerW}W` : undefined, specs.lengthMm !== undefined ? `길이 ${specs.lengthMm}mm` : undefined, specs.pcieSlotWidth !== undefined ? `PCIe x${specs.pcieSlotWidth}` : undefined]
            : part.category === "ssd"
              ? [specs.interface, specs.formFactor, specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined, specs.m2PcieGeneration !== undefined ? `PCIe ${specs.m2PcieGeneration.toFixed(1)}` : undefined, specs.sequentialReadMbps !== undefined ? `읽기 ${specs.sequentialReadMbps.toLocaleString("ko-KR")}MB/s` : undefined]
              : part.category === "hdd"
                ? [specs.interface, specs.formFactor, specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined]
                : part.category === "case"
                  ? [specs.motherboardFormFactors && specs.motherboardFormFactors.length > 0 ? `보드 ${specs.motherboardFormFactors.join("/")}` : undefined, specs.maxGpuLengthMm !== undefined ? `GPU ≤${specs.maxGpuLengthMm}mm` : undefined, specs.maxCoolerHeightMm !== undefined ? `쿨러 ≤${specs.maxCoolerHeightMm}mm` : undefined, specs.hddBays !== undefined ? `HDD 베이 ${specs.hddBays}개` : undefined]
                  : [specs.wattageW !== undefined ? `${specs.wattageW}W` : undefined, specs.psuFormFactor, specs.efficiency];
  return values.filter((value): value is string => Boolean(value && value.trim())).join(" · ");
}

function buildGeneratedLines(state: GeneratorState): GeneratedBuildLine[] {
  const order: PartCategory[] = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu"];
  return order.flatMap((category) => {
    const part = state.parts[category];
    if (!part || !isKnownPrice(part.priceWon)) return [];
    const selection = category === "memory" ? state.selection.memory[0]
      : category === "ssd" ? state.selection.ssd[0]
        : category === "hdd" ? state.selection.hdd[0]
          : state.selection[category];
    if (!selection) return [];
    return [{ category, partId: part.id, name: part.name, quantity: selection.quantity, priceWon: part.priceWon, specSummary: generatedPartSpecSummary(part) }];
  });
}

export function generateBuildDraft(catalog: Part[], request: BuildGenerationRequest): BuildGenerationResult {
  if (!Number.isFinite(request.budgetWon) || !Number.isInteger(request.budgetWon) || request.budgetWon <= 0) {
    throw new Error("예산은 1원 이상의 정수여야 합니다.");
  }
  const profile = request.profile;
  if (request.priority !== undefined && !["balanced", "budget", "performance"].includes(request.priority)) {
    throw new Error("자동 구성 우선순위는 balanced, budget, performance 중 하나여야 합니다.");
  }
  const priority = request.priority ?? "balanced";
  const memoryCapacityGb = request.memoryCapacityGb ?? 32;
  if (![16, 32, 64, 128].includes(memoryCapacityGb)) {
    throw new Error("RAM 목표 용량은 16, 32, 64, 128GB 중 하나여야 합니다.");
  }
  const gamingResolution = request.gamingResolution === "1080p" || request.gamingResolution === "4k"
    ? request.gamingResolution
    : DEFAULT_GAMING_RESOLUTION;
  const gamingRefreshRate = request.gamingRefreshRate === 60 || request.gamingRefreshRate === 144 || request.gamingRefreshRate === 240
    ? request.gamingRefreshRate
    : DEFAULT_GAMING_REFRESH_RATE;
  const listingPolicy = request.listingPolicy ?? (request.includeNonRetail ? "all" : "retail_only");
  const includeNonRetail = listingPolicy === "all";
  const storageCapacityGb = request.storageCapacityGb ?? 1000;
  const hddCount = request.hddCount ?? 0;
  const hddCapacityGb = request.hddCapacityGb ?? 4000;
  if (!Number.isInteger(storageCapacityGb) || storageCapacityGb <= 0 || !Number.isInteger(hddCount) || hddCount < 0 || hddCount > 8 || !Number.isInteger(hddCapacityGb) || hddCapacityGb <= 0) {
    throw new Error("저장장치 용량과 HDD 개수는 올바른 정수여야 합니다.");
  }
  const cpuPool = generatorCandidatePool(catalog, "cpu", profile, request.includeGpu ? undefined : (part) => part.specs.integratedGraphics === true, listingPolicy, gamingResolution, gamingRefreshRate);
  const motherboardPool = generatorCandidatePool(catalog, "motherboard", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate);
  const memoryPool = generatorMemoryPool(catalog, profile, memoryCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate);
  const coolerPool = generatorCandidatePool(catalog, "cooler", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate);
  const casePool = generatorCandidatePool(catalog, "case", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate, generatorCaseRequiredFields(request.includeGpu, hddCount), true);
  const ssdPool = generatorStoragePool(catalog, "ssd", profile, storageCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate);
  const hddPool = hddCount > 0 ? generatorStoragePool(catalog, "hdd", profile, hddCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate) : undefined;
  const psuPool = generatorCandidatePool(catalog, "psu", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate);
  const gpuPool = request.includeGpu ? generatorCandidatePool(catalog, "gpu", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate) : undefined;
  const missingPools = [
    ["CPU", cpuPool.parts.length],
    ["메인보드", motherboardPool.parts.length],
    [`${memoryCapacityGb}GB RAM`, memoryPool.parts.length],
    ["CPU 쿨러", coolerPool.parts.length],
    ["케이스", casePool.parts.length],
    ["SSD", ssdPool.parts.length],
    ["파워서플라이", psuPool.parts.length],
    ...(hddCount > 0 ? [["HDD", hddPool?.parts.length ?? 0]] : []),
    ...(request.includeGpu ? [["그래픽카드", gpuPool?.parts.length ?? 0]] : [])
  ].filter(([, count]) => count === 0).map(([label]) => label);
  if (missingPools.length > 0) {
    throw new BuildGenerationError(`자동 구성에 필요한 확인된 데이터가 부족합니다: ${missingPools.join(", ")}`, [{
      id: "candidate-pools",
      title: "자동 구성에 필요한 후보 데이터가 부족합니다.",
      summary: `요청 조건에서 ${missingPools.join(", ")} 후보를 확인된 가격·필수 스펙 기준으로 찾지 못했습니다.`,
      facts: [
        { label: "CPU 후보", value: `${cpuPool.parts.length}개` },
        { label: "메인보드 후보", value: `${motherboardPool.parts.length}개` },
        { label: "RAM 후보", value: `${memoryPool.parts.length}개` },
        { label: "GPU 후보", value: `${gpuPool?.parts.length ?? 0}개` },
        { label: "SSD 후보", value: `${ssdPool.parts.length}개` },
        { label: "PSU 후보", value: `${psuPool.parts.length}개` }
      ],
      recommendation: "구매 조건·용량·외장 GPU 포함 여부를 조정하거나 후보 데이터가 보강된 뒤 다시 시도해 주세요."
    }]);
  }

  const base: GeneratorState = {
    selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: !request.includeGpu },
    parts: {},
    priceWon: 0,
    capabilityScore: 0
  };
  let states = expandGeneratorStates([base], "cpu", () => preferBudgetCandidates(cpuPool.parts.filter((part) => request.includeGpu || part.specs.integratedGraphics === true), request.budgetWon, 0.35), cpuPool.scores, profile, request.budgetWon, undefined, Math.max(160, cpuPool.parts.length));
  if (states.length === 0) throw new Error("선택한 사용 목적에 맞는 CPU 후보를 찾지 못했습니다.");
  states = expandGeneratorStates(states, "motherboard", (state) => {
    const cpu = state.parts.cpu;
    return cpu ? preferBudgetCandidates(motherboardPool.parts.filter((part) => generatorCpuCanUseMotherboard(cpu, part)), request.budgetWon, 0.2) : [];
  }, motherboardPool.scores, profile, request.budgetWon);
  const cpuMotherboardPairCount = cpuPool.parts.reduce((total, cpu) => total + motherboardPool.parts.filter((motherboard) => generatorCpuCanUseMotherboard(cpu, motherboard)).length, 0);
  requireGeneratorStates(states, "CPU와 소켓·전원부가 맞는 메인보드 후보를 찾지 못했습니다.", [{
    id: "cpu-motherboard-pair",
    title: "CPU와 메인보드의 호환쌍이 남지 않았습니다.",
    summary: "현재 후보에서 소켓·메모리 타입·전원부를 동시에 만족하는 연결을 먼저 찾지 못했습니다.",
    facts: [
      { label: "CPU 후보", value: `${cpuPool.parts.length}개` },
      { label: "메인보드 후보", value: `${motherboardPool.parts.length}개` },
      { label: "호환쌍", value: `${cpuMotherboardPairCount}개` }
    ],
    recommendation: "구매 조건을 넓히거나 다른 CPU·메인보드 조합을 선택해 다시 시도해 주세요."
  }]);
  states = expandGeneratorStates(states, "memory", (state) => {
    const motherboard = state.parts.motherboard;
    const cpu = state.parts.cpu;
    return motherboard ? preferBudgetCandidates(memoryPool.parts.filter((part) => generatorMemoryCanUseMotherboard(part, motherboard, cpu)), request.budgetWon, 0.16, 2) : [];
  }, memoryPool.scores, profile, request.budgetWon);
  requireGeneratorStates(states, `${memoryCapacityGb}GB 이상이며 메인보드와 규격·용량·속도가 맞는 RAM 후보를 찾지 못했습니다.`, [{
    id: "memory-motherboard-fit",
    title: "요청 RAM 조건을 만족하는 메인보드 연결이 없습니다.",
    summary: "RAM 용량·속도·프로파일·물리 모듈 수와 CPU·메인보드 상한을 함께 통과하는 후보가 남지 않았습니다.",
    facts: [
      { label: "RAM 후보", value: `${memoryPool.parts.length}개` },
      { label: "요청 용량", value: `${memoryCapacityGb}GB 이상` },
      { label: "기본 킷 수량", value: "2개" }
    ],
    recommendation: "RAM 목표 용량·속도 조건을 낮추거나 메인보드 후보를 바꿔 다시 시도해 주세요."
  }]);
  states = expandGeneratorStates(states, "cooler", (state) => {
    const cpu = state.parts.cpu;
    return cpu ? preferBudgetCandidates(coolerPool.parts.filter((part) => generatorCoolerCanUseCpu(part, cpu)), request.budgetWon, 0.1) : [];
  }, coolerPool.scores, profile, request.budgetWon);
  requireGeneratorStates(states, "CPU 소켓·발열과 맞는 CPU 쿨러 후보를 찾지 못했습니다.", [{
    id: "cpu-cooler-fit",
    title: "CPU의 소켓·발열 조건을 만족하는 쿨러가 없습니다.",
    summary: "현재 CPU 후보와 쿨러 후보의 지원 소켓·최대 냉각 용량을 함께 통과하지 못했습니다.",
    facts: [
      { label: "CPU 후보 상태", value: `${states.length}개 조합` },
      { label: "쿨러 후보", value: `${coolerPool.parts.length}개` }
    ],
    recommendation: "CPU 쿨러 후보를 확인하거나 사용 목적·예산 조건을 조정해 주세요."
  }]);
  if (request.includeGpu && gpuPool) {
    states = expandGeneratorStates(states, "gpu", (state) => preferBudgetCandidates(gpuPool.parts, request.budgetWon, 0.6), gpuPool.scores, profile, request.budgetWon);
    requireGeneratorStates(states, "외장 그래픽카드와 앞선 부품 조건을 함께 만족하는 후보를 찾지 못했습니다.", [{
      id: "gpu-fit",
      title: "앞선 부품과 함께 사용할 그래픽카드가 없습니다.",
      summary: "GPU 후보를 연결한 뒤 케이스 장착 길이·전력 조건을 적용하기 전에 조합이 남지 않았습니다.",
      facts: [
        { label: "GPU 후보 풀", value: `${gpuPool.parts.length}개` },
        { label: "외장 GPU", value: "포함" }
      ],
      recommendation: "외장 GPU를 제외하거나 구매 조건·예산을 조정해 다시 시도해 주세요."
    }]);
  }
  states = expandGeneratorStates(states, "case", (state) => {
    const motherboard = state.parts.motherboard;
    const cooler = state.parts.cooler;
    if (!motherboard || !cooler) return [];
    return preferBudgetCandidates(casePool.parts.filter((part) => generatorCaseCanUseParts(part, motherboard, cooler, state.parts.gpu, hddCount)), request.budgetWon, 0.15);
  }, casePool.scores, profile, request.budgetWon);
  requireGeneratorStates(states, "메인보드·쿨러·저장장치·GPU가 들어가는 케이스 후보를 찾지 못했습니다.", [{
    id: "case-fit",
    title: "선택한 부품을 함께 수용하는 케이스가 없습니다.",
    summary: "메인보드 폼팩터·쿨러 높이·GPU 길이·파워 길이와 요청 저장장치 조건을 동시에 만족하는 케이스가 남지 않았습니다.",
    facts: [
      { label: "케이스 후보", value: `${casePool.parts.length}개` },
      { label: "GPU 포함", value: request.includeGpu ? "예" : "아니오" },
      { label: "HDD 요청", value: `${hddCount}개` }
    ],
    recommendation: "GPU·HDD 수량을 낮추거나 장착 여유가 큰 케이스를 선택해 주세요."
  }]);
  const statesBeforeSsd = states;
  states = expandGeneratorStates(states, "ssd", (state) => {
    const motherboard = state.parts.motherboard;
    return motherboard
      ? preferBudgetCandidates(preferRequestedCapacity(ssdPool.parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb >= storageCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, undefined, hddCount)), storageCapacityGb), request.budgetWon, 0.15)
      : [];
  }, ssdPool.scores, profile, request.budgetWon);
  requireGeneratorStates(states, `${storageCapacityGb.toLocaleString("ko-KR")}GB 이상 SSD를 포함한 호환 조합을 찾지 못했습니다.`, [{
    id: "storage-fit",
    title: "요청 저장장치 조건을 만족하는 연결이 없습니다.",
    summary: "SSD 용량·인터페이스·PCIe 세대와 메인보드 슬롯·SATA 포트, 요청한 HDD 수량을 함께 확인했지만 조합이 남지 않았습니다.",
    facts: [
      { label: "요청 SSD", value: `${storageCapacityGb.toLocaleString("ko-KR")}GB 이상` },
      { label: "SSD 후보 풀", value: `${ssdPool.parts.length}개` },
      { label: "요청 HDD", value: `${hddCount}개` },
      { label: "후보 메인보드", value: [...new Set(statesBeforeSsd.map((state) => state.parts.motherboard?.id).filter((id): id is string => Boolean(id)))].length + "개" }
    ],
    recommendation: "SSD 목표 용량을 낮추거나 HDD 수량을 줄여 SATA·M.2 연결 여유를 확보해 주세요."
  }]);
  if (hddCount > 0 && hddPool) {
    const statesBeforeHdd = states;
    states = expandGeneratorStates(states, "hdd", (state) => {
      const motherboard = state.parts.motherboard;
      const ssd = state.parts.ssd;
      return motherboard
        ? preferBudgetCandidates(preferRequestedCapacity(hddPool.parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb >= hddCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, ssd, hddCount)), hddCapacityGb), request.budgetWon, 0.3, hddCount)
        : [];
    }, hddPool.scores, profile, request.budgetWon, hddCount);
    requireGeneratorStates(states, `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상 HDD ${hddCount}개를 포함한 호환 조합을 찾지 못했습니다.`, [{
      id: "hdd-fit",
      title: "요청 HDD 수량을 수용하는 연결·장착 공간이 없습니다.",
      summary: "HDD 용량·SATA 포트·케이스 베이를 함께 확인했지만 요청 개수를 충족하는 조합이 남지 않았습니다.",
      facts: [
        { label: "요청 HDD", value: `${hddCount}개` },
        { label: "요청 용량", value: `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상` },
        { label: "HDD 후보 풀", value: `${hddPool?.parts.length ?? 0}개` },
        { label: "앞선 조합", value: `${statesBeforeHdd.length}개` }
      ],
      recommendation: "HDD 수량·용량을 낮추거나 SATA 포트와 베이가 더 많은 메인보드·케이스를 선택해 주세요."
    }]);
  }
  states = expandGeneratorStates(states, "psu", (state) => preferBudgetCandidates(psuPool.parts.filter((part) => generatorPsuCanUseGpu(part, state.parts.gpu)), request.budgetWon, 0.25), psuPool.scores, profile, request.budgetWon);
  requireGeneratorStates(states, "그래픽카드와 시스템 전력에 맞는 파워서플라이 후보를 찾지 못했습니다.", [{
    id: "gpu-psu-fit",
    title: "그래픽카드와 시스템 전력에 맞는 파워가 없습니다.",
    summary: "그래픽카드 권장 파워 용량과 파워서플라이 정격 출력 조건을 함께 만족하지 못했습니다.",
    facts: [
      { label: "파워 후보", value: `${psuPool.parts.length}개` },
      { label: "외장 GPU", value: request.includeGpu ? "포함" : "미포함" }
    ],
    recommendation: "그래픽카드를 낮추거나 더 높은 정격 출력의 파워서플라이를 선택해 주세요."
  }]);

  const evaluated = states.map((state) => ({ state, evaluation: evaluateBuild(state.selection, catalog, { includeSuggestions: false }) }));
  const ranked = evaluated.sort((a, b) => {
    const aValid = a.evaluation.blockerCount === 0 && a.evaluation.unknownCount === 0;
    const bValid = b.evaluation.blockerCount === 0 && b.evaluation.unknownCount === 0;
    const aWithin = a.state.priceWon <= request.budgetWon;
    const bWithin = b.state.priceWon <= request.budgetWon;
    const priorityComparison = priority === "budget"
      ? a.state.priceWon - b.state.priceWon
      : priority === "performance"
        ? b.state.capabilityScore - a.state.capabilityScore
        : generatorStateScore(b.state, request.budgetWon) - generatorStateScore(a.state, request.budgetWon);
    return Number(bValid) - Number(aValid)
      || Number(bWithin) - Number(aWithin)
      || a.evaluation.blockerCount - b.evaluation.blockerCount
      || a.evaluation.unknownCount - b.evaluation.unknownCount
      || a.evaluation.warningCount - b.evaluation.warningCount
      || priorityComparison
      || a.state.priceWon - b.state.priceWon;
  });
  const chosen = ranked[0];
  const generatedEvaluation = evaluateBuild(chosen.state.selection, catalog, {
    includeSuggestions: false,
    includeAnalysis: true,
    recommendationPreferences: {
      profile,
      priority,
      gamingResolution,
      gamingRefreshRate,
      listingPolicy,
      budgetWon: request.budgetWon
    }
  });
  const totalPriceWon = chosen.state.priceWon;
  const budgetDeltaWon = totalPriceWon - request.budgetWon;
  const withinBudget = budgetDeltaWon <= 0;
  const gpuTarget = profile === "gaming" && request.includeGpu && chosen.state.parts.gpu
    ? gpuTargetEvidenceFor(chosen.state.parts.gpu, undefined, gamingResolution, gamingRefreshRate)
    : undefined;
  const warnings = chosen.evaluation.findings
    .filter((finding) => finding.severity === "warning" || finding.severity === "unknown" || finding.severity === "blocker")
    .map((finding) => finding.title);
  if (gpuTarget?.currentFit === "partial") warnings.unshift(`${gpuTarget.summary}. 목표 해상도에 맞는 VRAM이 부족할 수 있습니다.`);
  if (gpuTarget?.currentFit === "unknown") warnings.unshift(`${gpuTarget.summary}. GPU VRAM을 원문에서 확인해 주세요.`);
  if (!withinBudget) warnings.unshift(`목표 예산을 ${formatPrice(Math.abs(budgetDeltaWon))} 초과합니다.`);
  return {
    selection: chosen.state.selection,
    profile,
    priority,
    gamingResolution,
    gamingRefreshRate,
    memoryCapacityGb,
    ...(gpuTarget ? { gpuTarget } : {}),
    analysis: generatedEvaluation.analysis,
    budgetWon: request.budgetWon,
    includeNonRetail,
    listingPolicy,
    storageCapacityGb,
    hddCapacityGb: hddCount > 0 ? hddCapacityGb : undefined,
    hddCount,
    totalPriceWon,
    budgetDeltaWon,
    withinBudget,
    priceComplete: chosen.evaluation.priceComplete,
    status: chosen.evaluation.status,
    blockerCount: chosen.evaluation.blockerCount,
    warningCount: chosen.evaluation.warningCount,
    unknownCount: chosen.evaluation.unknownCount,
    lines: buildGeneratedLines(chosen.state),
    rationale: [
      profileSummaryFor(profile),
      `${RECOMMENDATION_PRIORITY_LABELS[priority]} 기준으로 예산·후보 성능 점수를 정렬했습니다.`,
      request.includeGpu ? "외장 그래픽카드를 포함한 구성입니다." : "CPU 내장 그래픽을 사용하는 구성입니다.",
      request.includeGpu && profile === "gaming"
        ? `${GAMING_RESOLUTION_LABELS[gamingResolution]} · ${GAMING_REFRESH_RATE_LABELS[gamingRefreshRate]} 기준으로 권장 VRAM ${GAMING_RESOLUTION_VRAM_TARGETS[gamingResolution]}GB와 GPU·CPU 처리 스펙을 더 중요하게 반영했습니다.`
        : "게임 해상도 기준은 게이밍 프로필에서만 GPU 추천 가중치에 반영했습니다.",
      "후보 부품을 같은 호환성 규칙으로 다시 검증한 뒤 초안으로 제공합니다.",
      `RAM ${memoryCapacityGb.toLocaleString("ko-KR")}GB 이상을 충족하는 2개 구성과 ${storageCapacityGb.toLocaleString("ko-KR")}GB 이상 SSD 1개를 기본으로 구성했습니다.`,
      hddCount > 0
        ? `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상 HDD ${hddCount}개를 포함하고 메인보드 SATA 포트와 케이스 베이를 함께 확인했습니다.`
        : "HDD는 요청하지 않아 초안에서 제외했습니다.",
      `${LISTING_POLICY_LABELS[listingPolicy]} 조건으로 후보를 제한했습니다.${listingPolicy === "retail_only" ? " 중고·해외구매·벌크 상품은 기본적으로 제외했습니다." : " 상품별 유통 조건을 구매 전에 확인해 주세요."}`
    ],
    warnings
  };
}

export function buildGenerationRecoveryOptionsFor(catalog: Part[], request: BuildGenerationRequest): BuildGenerationRecoveryOption[] {
  const candidates: Array<Pick<BuildGenerationRecoveryOption, "id" | "label" | "summary" | "changedFields"> & { request: BuildGenerationRequest }> = [];
  const addCandidate = (candidate: typeof candidates[number]) => {
    if (JSON.stringify(candidate.request) === JSON.stringify(request)) return;
    if (candidates.some((existing) => JSON.stringify(existing.request) === JSON.stringify(candidate.request))) return;
    candidates.push(candidate);
  };
  if (request.listingPolicy === "retail_only" || (request.listingPolicy === undefined && !request.includeNonRetail)) {
    addCandidate({
      id: "include-bulk",
      label: "벌크 포함으로 다시 찾기",
      summary: "신품·정식 유통만 제한하지 않고 벌크 상품까지 후보에 포함합니다.",
      changedFields: ["구매 조건: 벌크 포함"],
      request: { ...request, listingPolicy: "include_bulk", includeNonRetail: false }
    });
    addCandidate({
      id: "include-all-listings",
      label: "전체 유통 조건으로 다시 찾기",
      summary: "벌크·병행수입·해외구매·중고까지 포함해 호환 조합을 다시 탐색합니다.",
      changedFields: ["구매 조건: 전체 조건"],
      request: { ...request, listingPolicy: "all", includeNonRetail: true }
    });
  }
  if (request.includeGpu) {
    addCandidate({
      id: "without-discrete-gpu",
      label: "외장 그래픽카드 제외",
      summary: "CPU 내장 그래픽을 사용하는 사무·일반형 조합으로 다시 탐색합니다.",
      changedFields: ["외장 그래픽카드 제외"],
      request: { ...request, includeGpu: false }
    });
  }
  const memorySteps = [16, 32, 64, 128].filter((capacity) => capacity < (request.memoryCapacityGb ?? 32)).reverse();
  const lowerMemoryCapacity = memorySteps[0];
  if (lowerMemoryCapacity !== undefined) {
    addCandidate({
      id: `memory-${lowerMemoryCapacity}`,
      label: `RAM ${lowerMemoryCapacity}GB 기준으로 다시 찾기`,
      summary: `RAM 목표 용량을 ${lowerMemoryCapacity}GB로 낮춰 호환 후보를 다시 탐색합니다.`,
      changedFields: [`RAM 목표: ${lowerMemoryCapacity}GB`],
      request: { ...request, memoryCapacityGb: lowerMemoryCapacity }
    });
  }
  const storageSteps = [500, 1000, 2000, 4000].filter((capacity) => capacity < (request.storageCapacityGb ?? 1000)).reverse();
  const lowerStorageCapacity = storageSteps[0];
  if (lowerStorageCapacity !== undefined) {
    addCandidate({
      id: `storage-${lowerStorageCapacity}`,
      label: `SSD ${lowerStorageCapacity >= 1000 ? `${lowerStorageCapacity / 1000}TB` : `${lowerStorageCapacity}GB`} 기준으로 다시 찾기`,
      summary: `기본 SSD 목표 용량을 ${lowerStorageCapacity.toLocaleString("ko-KR")}GB로 낮춰 호환 후보를 다시 탐색합니다.`,
      changedFields: [`SSD 목표: ${lowerStorageCapacity.toLocaleString("ko-KR")}GB`],
      request: { ...request, storageCapacityGb: lowerStorageCapacity }
    });
  }
  if ((request.hddCount ?? 0) > 0) {
    const lowerHddCounts = [1, 2, 4].filter((count) => count < (request.hddCount ?? 0)).reverse();
    const lowerHddCount = lowerHddCounts[0];
    if (lowerHddCount !== undefined) {
      addCandidate({
        id: `hdd-${lowerHddCount}`,
        label: `HDD ${lowerHddCount}개로 다시 찾기`,
        summary: `HDD 수량을 ${lowerHddCount}개로 낮춰 SATA 포트와 케이스 베이 여유를 다시 확인합니다.`,
        changedFields: [`HDD 수량: ${lowerHddCount}개`],
        request: { ...request, hddCount: lowerHddCount }
      });
    }
    addCandidate({
      id: "without-hdd",
      label: "HDD 없이 다시 찾기",
      summary: "HDD 베이와 SATA 포트 조건을 제거하고 SSD 중심 조합을 탐색합니다.",
      changedFields: ["HDD 제외"],
      request: { ...request, hddCount: 0 }
    });
  }
  if (request.budgetWon < 100_000_000) {
    const expandedBudget = Math.min(100_000_000, Math.ceil(request.budgetWon * 1.2 / 10_000) * 10_000);
    if (expandedBudget > request.budgetWon) {
      addCandidate({
        id: "budget-plus-20",
        label: "예산을 20% 늘려 다시 찾기",
        summary: `목표 예산을 ${expandedBudget.toLocaleString("ko-KR")}원으로 늘려 후보 조합을 탐색합니다.`,
        changedFields: [`목표 예산: ${expandedBudget.toLocaleString("ko-KR")}원`],
        request: { ...request, budgetWon: expandedBudget }
      });
    }
  }
  return candidates.flatMap((candidate) => {
    try {
      const draft = generateBuildDraft(catalog, candidate.request);
      if (draft.status === "incompatible" || draft.blockerCount > 0) return [];
      return [{
        ...candidate,
        preview: {
          totalPriceWon: draft.totalPriceWon,
          budgetDeltaWon: draft.budgetDeltaWon,
          withinBudget: draft.withinBudget,
          priceComplete: draft.priceComplete,
          status: draft.status,
          blockerCount: draft.blockerCount,
          warningCount: draft.warningCount,
          unknownCount: draft.unknownCount
        }
      }];
    } catch {
      return [];
    }
  }).slice(0, 6);
}

export function selectionFromCatalog(catalog: Part[], category: PartCategory, partId: string): PartSelection | undefined {
  return catalog.some((part) => part.category === category && part.id === partId)
    ? { partId, quantity: 1 }
    : undefined;
}

export function selectedPartSummary(catalog: Part[], selection: PartSelection | undefined) {
  const part = selectedPart(catalog, selection);
  return part
    ? {
        id: part.id,
        name: part.name,
        category: part.category,
        priceWon: part.priceWon,
        dataQuality: part.dataQuality
      }
    : undefined;
}

export function formatBuildPrice(catalog: Part[], build: BuildSelection) {
  return formatPrice(buildPriceInfo(catalog, build).total);
}
