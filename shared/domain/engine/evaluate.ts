import { type EngineClockOptions, type EvaluationCache, KO_NUMBER_FORMAT, type SelectionWithPart, physicalMemoryModuleCount, categorySelections, cloneBuild, similarityBasisForDimensions, DEFAULT_GAMING_RESOLUTION, DEFAULT_GAMING_REFRESH_RATE, currentCategoryPart, selectedParts, performanceComparisonFor, candidateIsPlausible, recommendedMemoryKitQuantity, replaceSelection, candidateCompatibilityDeltaFindings, candidateDataQualityReasonsFor, physicalEvidenceSummaryFor, gpuTargetEvidenceFor, valueForPrices, benchmarkFreshnessFor, performanceSummaryFor, profileSummaryFor, similarityFor, type SimilarityComparison, partReliabilityScoreFor, similarityScoreForSort, similarityLabelFor, formatPrice, engineNowMilliseconds, selectedPart, motherboardVrmTierFor, motherboardMemorySlotFormFactorFor, memoryModuleCapacityGb, cpuMemorySpeedLimitFor, isTwoPointFiveInchStorage, twoPointFiveInchMountCapacity, PSU_LOAD_HEADROOM_RATIO, SYSTEM_BASE_LOAD_W, pcieEightPinRequirementCount, severityRank, buildPriceInfo, ENGINE_VERSION, limitUpgradeRecommendations, performanceDimensions, generatorObjectiveScores, GENERATOR_CATEGORY_WEIGHTS, formatTargetVram } from "./core";
import { type RecommendationPreferences, type RecommendationSearchSummary, type BuildSelection, type RecommendationProfile, type BuildAnalysis, type Part, type FindingAction, type PartCategory, CATEGORY_LABELS, type PciePowerConnectorKind, type PciePowerRequirement, type MemoryProfile, type Finding, type FindingSeverity, type FindingFact, type M2SlotProfile, type M2SlotAssignment, type BuildMetrics, type SimilarityEvidence, type ListingPolicy, type GamingResolution, type GamingRefreshRate, type Suggestion, type PartSelection, isKnownPrice, type CompatibilityResult, type AlternativeRisk, type SimilarityBasis, type RecommendationPlan, type CompatibilityLink, type BuildAnalysisBalance, type BuildAnalysisFactor, type BuildAnalysisInsight, RECOMMENDATION_PROFILE_LABELS, PART_CATEGORIES, type BuildBottleneck, GAMING_RESOLUTION_LABELS } from "../../types";
import { OBJECTIVE_SCORE_MODEL_VERSION, type ObjectiveScore } from "../../objective-score";
import { catalogMissingFieldLabelFor } from "../../catalog-spec-coverage";
import { compareCandidateSimilarity } from "./alternatives";
import { isQuoteSelectable, isQuoteBrandAllowed, isListingAllowed, cpuHasIntegratedGraphics } from "../listing";
import { recommendationTrustFor, compareRecommendationTrust } from "../recommendation-trust";
import { caseFanHeaderCapacityFor, buildCoolerTypeFor } from "../../build-connectivity";
import { radiatorClearanceFindings } from "../radiator-clearance";
import { pciePowerMatchFor, gpuFitSummaryFor } from "../../gpu-fit";
import { buildBenchmarkSnapshotFor } from "../../build-benchmark-snapshot";
import { rankedUpgradeRecommendations, buildUpgradeBundlesWithSummary } from "./upgrades";
import { cpuGpuBalanceFor } from "../../cpu-gaming-policy";

const GPU_THICKNESS_WARNING_MM = 55;
// 확장 슬롯 간격(0.8인치). 2슬롯 카드 ≈ 40mm, 3슬롯 ≈ 61mm.
const PCIE_SLOT_PITCH_MM = 20.32;
const MAX_EVALUATION_CACHE_ENTRIES = 4096;
const REPAIR_PLAN_OPTIONS_PER_CATEGORY = 4;
const CANDIDATE_EVALUATION_POOL_SIZE = 192;
const VERIFIED_CANDIDATE_RESERVE_SIZE = 12;
const BUNDLE_CANDIDATE_MAX_PER_CATEGORY = 4;
const BUNDLE_CANDIDATE_MAX_TOTAL = 24;

type EngineOptions = EngineClockOptions & {
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

const ANALYSIS_SCORE_BASIS = "측정된 벤치마크와 확인된 스펙을 부품 범주별 고정 기준값과 비교한 성능 지수입니다. 카탈로그에 다른 부품이 추가/제거되어도 같은 부품의 점수는 바뀌지 않습니다.";

function emptyBuildAnalysis(profile: RecommendationProfile): BuildAnalysis {
  return {
    profile,
    scoreLabel: "계산 불가",
    scoreBasis: ANALYSIS_SCORE_BASIS,
    scoreModelVersion: OBJECTIVE_SCORE_MODEL_VERSION,
    confidence: "unknown",
    factors: [],
    strengths: [],
    focusAreas: [],
    bottlenecks: [],
    nextActions: []
  };
}
const GPU_RECOMMENDED_PSU_SYSTEM_ALLOWANCE_W = 300;

// 전원부는 페이즈/출력으로 W를 추정하지 않고, "고전력 CPU × 보급형 보드" 조합만 경고한다.
// 기준값은 실측 보정 전 임시값이다 — docs/vrm-judgement-issue-2026-10-06.md 참고.
const VRM_HIGH_POWER_CPU_W = 150;
// AMD 데스크톱 CPU의 PPT는 TDP × 1.35로 정의된다.
const AMD_PPT_PER_TDP = 1.35;

type CpuPeakPower = { watts: number; basisLabel: string };

/** Sustained-peak package power for the VRM rule: PPT, Intel MTP, AMD TDP × 1.35, then TDP. */
function cpuPeakPowerFor(cpu: Part): CpuPeakPower | undefined {
  const { pptW, cpuMaxTurboPowerW, tdpW, socket } = cpu.specs;
  if (pptW !== undefined) return { watts: pptW, basisLabel: "PPT" };
  if (cpuMaxTurboPowerW !== undefined) return { watts: cpuMaxTurboPowerW, basisLabel: "최대 터보 전력(MTP)" };
  if (tdpW === undefined) return undefined;
  if (socket && /^AM\d/i.test(socket)) return { watts: Math.round(tdpW * AMD_PPT_PER_TDP), basisLabel: `TDP ${tdpW}W × ${AMD_PPT_PER_TDP}(AMD PPT 정의)` };
  return { watts: tdpW, basisLabel: "TDP" };
}

// 추정 비교는 원값으로 하고, 화면에 보이는 W 값만 반올림한다.
function formatEstimatedWatts(value: number) {
  return formatNumber(Math.round(value), "W");
}

function partIds(...parts: Array<Part | undefined>) {
  return parts.filter((part): part is Part => Boolean(part)).map((part) => part.id);
}

function formatNumber(value: number | undefined, suffix = "") {
  // 예전 수집본 JSON에는 미확인 값이 null로 남아 있을 수 있다.
  return value === undefined || value === null ? "확인할 수 없음" : `${KO_NUMBER_FORMAT.format(value)}${suffix}`;
}

function radiatorPositionLabel(position: string) {
  return ({ front: "전면", top: "상단", bottom: "하단", side: "측면", rear: "후면", psu_shroud: "파워 커버" } as Record<string, string>)[position] ?? position;
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

function isFullyCompatible(blockerCount: number, warningCount: number, unknownCount: number) {
  return blockerCount === 0 && warningCount === 0 && unknownCount === 0;
}

function remainingIssueSummary(blockerCount: number, warningCount: number, unknownCount: number) {
  return `남은 호환 불가 ${blockerCount}개 / 주의 ${warningCount}개 / 확인 필요 ${unknownCount}개`;
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
    missingFields.map((field) => ({ label: "누락된 정보", actual: catalogMissingFieldLabelFor(field) })),
    [action("verify_spec", targetCategory ? `${CATEGORY_LABELS[targetCategory]} 스펙 확인` : "제조사 스펙 확인", targetCategory)]
  );
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

function similarityBasisForEvidence(evidence: SimilarityEvidence) {
  return evidence.basis ?? similarityBasisForDimensions(evidence.dimensions ?? []);
}

function compareSimilarityResults(
  left: { score: number; evidence: SimilarityEvidence },
  right: { score: number; evidence: SimilarityEvidence }
) {
  return compareCandidateSimilarity(
    { similarityScore: left.score, similarityEvidence: left.evidence },
    { similarityScore: right.score, similarityEvidence: right.evidence }
  );
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
  const comparison = performanceComparisonFor(currentTarget, catalog);
  const candidates = catalog
    .filter((part) => part.category === targetCategory && !currentPartIds.has(part.id))
    // seed도 세대 게이트를 통과한다 — 트윈/단종 추정은 isQuoteSelectable이 처리.
    .filter((part) => isQuoteSelectable(part, catalog))
    .filter((part) => isQuoteBrandAllowed(targetCategory, part.brand, part.name))
    .filter((part) => isListingAllowed(part, listingPolicy))
    .filter((part) => candidateIsPlausible(finding, build, part, catalog, targetCategory));
  const evaluatedSuggestions = candidateEvaluationPoolFor(
    candidates,
    currentTarget,
    comparison,
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
      const candidateDataQualityReasons = candidateDataQualityReasonsFor(part);
      const candidateRisk: AlternativeRisk = candidateBlockerCount > 0
        ? "unsafe"
        : candidateUnknownCount > 0 || candidateDataQualityReasons.length > 0
          ? "review"
          : "safe";
      const candidateReasons = [...new Set(candidateDeltaFindings
        .filter((item) => item.severity === "blocker" || item.severity === "unknown")
        .map((item) => item.title))];
      candidateReasons.unshift(...candidateDataQualityReasons.filter((reason) => !candidateReasons.includes(reason)));
      const physicalEvidence = physicalEvidenceSummaryFor(targetCategory, evaluation);
      const gpuTarget = profile === "gaming" && targetCategory === "gpu" && currentTarget
        ? gpuTargetEvidenceFor(currentTarget, part, gamingResolution, gamingRefreshRate)
        : undefined;
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
        benchmarkFreshness: benchmarkFreshnessFor(part),
        benchmarkSourceCheck: part.specs.benchmarkProvenance?.sourceCheck,
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
          candidateRisk,
          ...(candidateReasons.length > 0 ? { candidateReasons } : {}),
          candidateBlockerCount,
          candidateWarningCount,
          candidateUnknownCount,
          reason: fullyCompatible
            ? `이 부품으로 교체하면 전체 구성도 호환됩니다.${candidateReasons.length > 0 ? ` ${candidateReasons.join(" / ")}는 구매 전에 확인해야 합니다.` : ""}`
            : `이 호환 문제를 해결합니다. ${remainingIssueSummary(evaluation.blockerCount, evaluation.warningCount, evaluation.unknownCount)}는 별도로 남습니다.${candidateReasons.length > 0 ? ` ${candidateReasons.join(" / ")}는 구매 전에 확인해야 합니다.` : ""}`,
          remainingBlockers: evaluation.blockerCount,
          remainingWarnings: evaluation.warningCount,
          remainingUnknown: evaluation.unknownCount,
          priceDeltaWon,
          fixesCurrentIssue,
          similarityScore: similarity.score,
          similarityLabel: similarity.label,
          similarityEvidence: similarity.evidence,
          performanceSummary: performanceSummaryFor(currentTarget, part, comparison),
          profileSummary: profileSummaryFor(profile),
          recommendationTrust,
          ...(physicalEvidence ? { physicalEvidence } : {}),
          ...(gpuTarget ? { gpuTarget } : {}),
          ...(value ?? {})
        }
      };
    });
  const safeSuggestions = evaluatedSuggestions
    .filter(({ suggestion }) => suggestion.fixesCurrentIssue && suggestion.candidateRisk === "safe");
  const reviewSuggestions = evaluatedSuggestions
    .filter(({ suggestion }) => suggestion.fixesCurrentIssue
      && suggestion.candidateRisk === "review"
      && suggestion.candidateBlockerCount === 0);
  const selectedSuggestions = safeSuggestions.length > 0 ? safeSuggestions : reviewSuggestions;
  return selectedSuggestions
    .map(({ suggestion }) => suggestion)
    .sort((a, b) => {
      const aFullyCompatible = a.remainingBlockers === 0 && a.remainingWarnings === 0 && a.remainingUnknown === 0;
      const bFullyCompatible = b.remainingBlockers === 0 && b.remainingWarnings === 0 && b.remainingUnknown === 0;
      const priorityComparison = priority === "reliability"
        ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust)
        : priority === "budget"
          ? (a.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.part.priceWon ?? Number.MAX_SAFE_INTEGER)
          : priority === "performance"
            ? compareCandidateSimilarity(a, b)
            : 0;
      return Number(bFullyCompatible) - Number(aFullyCompatible)
        || (priority === "reliability" ? priorityComparison : a.score - b.score)
        || (priority === "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || (priority === "reliability" ? 0 : priorityComparison)
        || (priority !== "balanced" && priority !== "reliability" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
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
  comparison: SimilarityComparison | undefined,
  profile: RecommendationProfile,
  priority: RecommendationPreferences["priority"],
  gamingResolution: GamingResolution,
  gamingRefreshRate: GamingRefreshRate,
  limit: number,
  searchContext?: RecommendationSearchContext
): CandidateEvaluationPoolEntry[] {
  const entries = candidates.map((part) => ({
    part,
    similarity: similarityFor(currentTarget, part, profile, gamingResolution, comparison, gamingRefreshRate)
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
    compareSimilarityResults(left.similarity, right.similarity)
    || left.part.id.localeCompare(right.part.id)
  );
  const priceRanked = entries
    .filter(({ part }) => isKnownPrice(part.priceWon))
    .sort((left, right) =>
      (left.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (right.part.priceWon ?? Number.MAX_SAFE_INTEGER)
      || compareSimilarityResults(left.similarity, right.similarity)
      || left.part.id.localeCompare(right.part.id)
    );
  const reliabilityRanked = [...entries].sort((left, right) =>
    partReliabilityScoreFor(right.part) - partReliabilityScoreFor(left.part)
    || compareSimilarityResults(left.similarity, right.similarity)
    || left.part.id.localeCompare(right.part.id)
  );
  const priorityRanked = priority === "budget" ? priceRanked : priority === "reliability" ? reliabilityRanked : similarityRanked;
  const verifiedRanked = similarityRanked.filter(({ part }) => part.dataQuality !== "incomplete");
  const selected = new Map<string, CandidateEvaluationPoolEntry>();
  const add = (items: CandidateEvaluationPoolEntry[], count: number) => {
    for (const item of items.slice(0, count)) {
      if (!selected.has(item.part.id)) selected.set(item.part.id, item);
    }
  };
  // 불완전 후보가 많아도 확인된 후보가 bounded pool 밖으로 밀리지 않도록
  // 유사도 기준 상위 verified 후보를 먼저 예약한다.
  add(verifiedRanked, VERIFIED_CANDIDATE_RESERVE_SIZE);
  add(priorityRanked, poolSize);
  add(similarityRanked, poolSize);
  add(priceRanked, Math.ceil(poolSize / 2));
  add(reliabilityRanked, Math.ceil(poolSize / 2));
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
          performanceSummary: `수량 ${fromQuantity}개 → ${toQuantity}개 / 동일 부품 성능 유지`,
          profileSummary: profileSummaryFor(profile),
          recommendationTrust: recommendationTrustFor({
            candidate: current,
            similarityEvidence,
            resolvesTarget: fixesCurrentIssue,
            benchmarkSourceKind: current.specs.benchmarkProvenance?.sourceKind,
            benchmarkFreshness: benchmarkFreshnessFor(current),
            benchmarkSourceCheck: current.specs.benchmarkProvenance?.sourceCheck,
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
      ? "이 구성을 적용하면 현재 확인된 호환 문제와 주의 항목이 모두 해결됩니다."
      : `호환 불가 ${result.blockerCount}개를 ${after.blockerCount}개로 줄입니다. ${remainingIssueSummary(after.blockerCount, after.warningCount, after.unknownCount)}는 적용 후 다시 확인할 수 있어요.`;
    return {
      title: `${changes.length}개 항목을 바꾸는 구성`,
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
  const planRecommendationTrustScoreFor = (options: PlanOption[]) => options.reduce((total, option) => total + (option.suggestion.recommendationTrust?.score ?? 0), 0);
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
          const preferenceComparison = priority === "reliability"
            ? planRecommendationTrustScoreFor(right.chosen) - planRecommendationTrustScoreFor(left.chosen)
            : priority === "budget"
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
        const preferenceComparison = priority === "reliability"
          ? planRecommendationTrustScoreFor(right.chosen) - planRecommendationTrustScoreFor(left.chosen)
          : priority === "budget"
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
        title: `완전 호환 우선 / ${candidate.changes.length}개 변경`,
        reason: `호환 문제를 줄이기 위해 ${candidate.changes.length}개 항목을 바꿔요. 적용 후 호환 불가/주의/확인 필요 항목이 없습니다.${candidate.priceComplete ? "" : " 일부 부품 가격은 확인해 주세요."}`
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
  const planTrustScore = (plan: RecommendationPlan) => plan.changes.reduce((total, change) => total + (change.recommendationTrust?.score ?? 0), 0);
  const strategies: Array<{
    label: RecommendationPlan["label"];
    qualityTolerance: number;
    compare: (a: RecommendationPlan, b: RecommendationPlan) => number;
  }> = [
    {
      label: "최소 변경",
      qualityTolerance: 0,
      compare: (a, b) => (priority === "reliability" ? planTrustScore(b) - planTrustScore(a) : byQuality(a, b))
        || (priority === "reliability" ? byQuality(a, b) : 0)
        || a.changes.length - b.changes.length
        || similarityScoreForSort(b) - similarityScoreForSort(a)
        || planPrice(a) - planPrice(b)
    },
    {
      label: "가성비",
      qualityTolerance: 1000,
      compare: (a, b) => (priority === "reliability" ? planTrustScore(b) - planTrustScore(a) : budgetScore(a) - budgetScore(b))
        || (priority === "reliability" ? budgetScore(a) - budgetScore(b) : 0)
        || byQuality(a, b)
        || a.changes.length - b.changes.length
        || similarityScoreForSort(b) - similarityScoreForSort(a)
    },
    {
      label: "성능 유지",
      qualityTolerance: 1000,
      compare: (a, b) => (priority === "reliability" ? planTrustScore(b) - planTrustScore(a) : similarityScoreForSort(b) - similarityScoreForSort(a))
        || (priority === "reliability" ? similarityScoreForSort(b) - similarityScoreForSort(a) : 0)
        || byQuality(a, b)
        || a.changes.length - b.changes.length
        || planPrice(a) - planPrice(b)
    }
  ];
  const strategyOrder: Record<RecommendationPreferences["priority"], RecommendationPlan["label"][]> = {
    balanced: ["최소 변경", "가성비", "성능 유지"],
    budget: ["가성비", "최소 변경", "성능 유지"],
    performance: ["성능 유지", "최소 변경", "가성비"],
    reliability: ["최소 변경", "성능 유지", "가성비"]
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
      title: `${strategy.label} / ${candidate.changes.length}개 ${changeLabel}`,
      reason: fullyCompatible
        ? `${strategy.label} 기준으로 현재 확인 가능한 호환 오류와 주의 항목을 모두 해결합니다.${budgetReason}`
        : `${strategy.label} 기준으로 호환 불가 ${result.blockerCount}개를 ${candidate.remainingBlockers}개로 줄입니다. ${remainingIssueSummary(candidate.remainingBlockers, candidate.remainingWarnings, candidate.remainingUnknown)}는 적용 후 다시 확인할 수 있어요.${budgetReason}`
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
        const priorityComparison = priority === "reliability"
          ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust)
          : priority === "budget"
            ? (a.part.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.part.priceWon ?? Number.MAX_SAFE_INTEGER)
            : priority === "performance"
              ? compareCandidateSimilarity(a, b)
              : 0;
      return Number(bFullyCompatible) - Number(aFullyCompatible)
        || (priority === "reliability" ? priorityComparison : a.score - b.score)
        || (priority === "balanced" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
        || (priority === "reliability" ? 0 : priorityComparison)
        || (priority !== "balanced" && priority !== "reliability" ? compareRecommendationTrust(a.recommendationTrust, b.recommendationTrust) : 0)
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
      summary: relatedMessages.length > 0 ? relatedMessages.join(" / ") : definition.compatibleSummary
    };
  };

  return [
    link({
      id: "cpu-motherboard",
      fromCategory: "cpu",
      toCategory: "motherboard",
      label: "소켓 / 전원부",
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
      label: "메인보드 ↔ RAM",
      ruleIds: ["memory-type", "memory-form-factor", "memory-capacity", "memory-module-capacity", "memory-slots", "memory-speed", "memory-profile", "memory-mixing"],
      active: Boolean(parts.motherboard && parts.memory.length > 0),
      compatibleSummary: "RAM 규격과 용량, 장착 조건을 확인했습니다."
    }),
    link({
      id: "motherboard-ssd",
      fromCategory: "motherboard",
      toCategory: "ssd",
      label: "M.2 / PCIe 세대 / SATA 연결",
      ruleIds: ["m2-slots", "m2-interface", "m2-pcie-generation", "m2-slot-topology", "m2-slot-selection", "m2-slot-pcie-generation", "m2-slot-routing", "m2-slot-sharing", "sata-ports"],
      active: Boolean(parts.motherboard && parts.ssds.length > 0),
      compatibleSummary: "M.2 인터페이스/슬롯과 연결 포트 기준을 통과했습니다."
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
      label: "폼팩터 / 팬/RGB 연결",
      ruleIds: ["case-motherboard-form-factor", "case-fan-headers", "case-rgb-headers", "case-rgb-voltage"],
      active: Boolean(parts.motherboard && parts.computerCase),
      compatibleSummary: "메인보드 폼팩터와 팬/RGB 연결 기준을 통과했습니다."
    }),
    link({
      id: "cpu-cooler",
      fromCategory: "cpu",
      toCategory: "cooler",
      label: "소켓 / 냉각 여유",
      ruleIds: ["cpu-cooler-socket", "cpu-cooler-capacity"],
      active: Boolean(parts.cpu && parts.cooler),
      compatibleSummary: "쿨러 소켓과 냉각 여유 기준을 통과했습니다."
    }),
    link({
      id: "cooler-case",
      fromCategory: "cooler",
      toCategory: "case",
      label: "높이 / 라디에이터",
      ruleIds: ["case-cooler-height", "case-radiator-support"],
      active: Boolean(parts.cooler && parts.computerCase),
      compatibleSummary: "쿨러 높이와 라디에이터 장착 기준을 통과했습니다."
    }),
    link({
      id: "gpu-case",
      fromCategory: "gpu",
      toCategory: "case",
      label: "그래픽카드 길이 / 두께",
      ruleIds: ["gpu-case-length", "gpu-thickness", "gpu-case-low-profile"],
      active: Boolean(parts.gpu && parts.computerCase),
      compatibleSummary: "그래픽카드 길이와 두께 정보 기준을 확인했습니다."
    }),
    link({
      id: "gpu-psu",
      fromCategory: "gpu",
      toCategory: "psu",
      label: "전력 / 보조전원 연결",
      ruleIds: ["gpu-psu-power", "gpu-psu-connector", "gpu-psu-cable-topology", "psu-data-quality"],
      active: Boolean(parts.gpu && parts.psu),
      compatibleSummary: "그래픽카드 권장 전력과 보조전원 커넥터 기준을 통과했습니다."
    }),
    link({
      id: "psu-case",
      fromCategory: "psu",
      toCategory: "case",
      label: "길이 / 폼팩터",
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
  const nowMilliseconds = engineNowMilliseconds(options.now);
  const evaluatedAt = options.now === undefined ? undefined : new Date(nowMilliseconds).toISOString();
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
        "CPU와 메인보드 소켓이 맞는지 확인해 주세요.",
        "CPU 또는 메인보드의 소켓 정보가 없어 서로 맞는지 확인하지 못했어요.",
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
    const cpuPeak = cpuPeakPowerFor(cpu);
    const vrmCapacity = motherboard.specs.vrmCapacityW;
    if (cpuPower === undefined || cpuPeak === undefined) {
      addUnknown(
        findings,
        "cpu-motherboard-power",
        "CPU 전력과 메인보드 전원부 용량을 확인해 주세요.",
        "CPU 전력 정보가 없어 부하가 클 때 메인보드 전원부가 감당할 수 있는지 확인하지 못했어요.",
        partIds(cpu, motherboard),
        ["CPU power"],
        "motherboard"
      );
    } else if (vrmCapacity !== undefined) {
      // 제조사 확인 용량이 있을 때만 차단한다. 차단 기준 전력은 기존과 같이 PPT(없으면 TDP)다.
      if (cpuPower > vrmCapacity) {
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
    } else if (cpuPeak.watts >= VRM_HIGH_POWER_CPU_W) {
      // 전원부 부족은 조립 불가가 아니라 고부하 지속 시 VRM 과열에 따른 전력 제한으로 나타난다.
      // 보급형 보드와 고전력 CPU 조합만 warning, 보드 등급을 모르면 info로만 알린다.
      const tier = motherboardVrmTierFor(motherboard);
      const cpuFact = { label: "CPU 최대 전력", actual: `${formatNumber(cpuPeak.watts, "W")} (${cpuPeak.basisLabel})` };
      if (tier.tier === "entry") {
        addFinding(
          findings,
          "cpu-motherboard-power",
          "warning",
          "보급형 메인보드에 고전력 CPU를 조합했습니다.",
          "고부하가 오래 이어지면 전원부 과열로 CPU 전력이 제한되어 성능이 덜 나올 수 있어요. 메인보드 제조사의 CPU 지원 목록과 전원부 사양을 확인해 주세요.",
          partIds(cpu, motherboard),
          [cpuFact, { label: "메인보드 전원부 등급", actual: tier.reason }],
          [replaceAction("motherboard"), action("verify_spec", "메인보드 전원부 사양 확인", "motherboard")]
        );
      } else if (tier.tier === "unknown") {
        addFinding(
          findings,
          "cpu-motherboard-power",
          "info",
          "메인보드 전원부 등급을 확인하지 못했습니다.",
          "고전력 CPU라 보급형 메인보드라면 고부하에서 전력이 제한될 수 있어요. 칩셋과 전원부 사양을 확인해 주세요.",
          partIds(cpu, motherboard),
          [cpuFact, { label: "메인보드 전원부 등급", expected: "확인 필요" }],
          [action("verify_spec", "메인보드 전원부 사양 확인", "motherboard")]
        );
      }
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
        "그래픽카드를 꽂을 PCIe 슬롯이 있는지 확인해 주세요.",
        "그래픽카드의 PCIe x16 연결을 메인보드가 지원하는지 확인하려면 슬롯 정보가 필요해요.",
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
        "그래픽카드를 꽂을 PCIe 슬롯이 있는지 확인해 주세요.",
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
          { label: "메인보드 PCIe 슬롯", expected: "x16 0개 / x8 0개" }
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
          "두 RAM 제품의 설정이 달라 둘 중 낮은 속도로 작동하거나 불안정할 수 있어요. 가능하면 같은 제품으로 맞춰 주세요.",
          affectedMemoryIds,
          mixFacts,
          [replaceAction("memory", "동일 킷 RAM 부품 찾기")]
        );
      } else if (incompleteFields.length > 0) {
        addFinding(
          findings,
          "memory-mixing",
          "unknown",
          "함께 고른 RAM의 속도와 전압을 확인해 주세요.",
          "두 RAM 제품의 속도나 전압 정보가 빠져 있어 함께 써도 괜찮은지 확인하지 못했어요. 두 제품의 사양을 비교해 주세요.",
          affectedMemoryIds,
          [
            ...mixFacts,
            { label: "확인되지 않은 비교 항목", actual: incompleteFields.map(({ label }) => label).join(" / ") }
          ],
          [action("verify_spec", "RAM 킷 정보 확인", "memory")]
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
        "CPU/메인보드/RAM의 메모리 규격을 확인해 주세요.",
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

    const memorySlotFormFactor = motherboardMemorySlotFormFactorFor(motherboard);
    const expectedMemoryFormFactor = memorySlotFormFactor.formFactor;
    const memoryFormFactorMismatch = expectedMemoryFormFactor
      ? memory.filter(({ part }) => part.specs.formFactor !== undefined && part.specs.formFactor !== expectedMemoryFormFactor)
      : [];
    // 폼팩터로 추론한 DIMM은 SO-DIMM RAM을 잡는 데만 쓴다. 규격 미기재 RAM에 새 "확인 필요"를 만들지 않는다.
    const shouldCheckMemoryFormFactor = (expectedMemoryFormFactor !== undefined && !memorySlotFormFactor.inferred)
      || memory.some(({ part }) => part.specs.formFactor === "SO-DIMM");
    if (shouldCheckMemoryFormFactor && (!expectedMemoryFormFactor || memory.some(({ part }) => part.specs.formFactor === undefined))) {
      addUnknown(
        findings,
        "memory-form-factor",
        "RAM 크기가 메인보드 슬롯에 맞는지 확인해 주세요.",
        "RAM 크기(DIMM/SO-DIMM)나 메인보드 슬롯 정보가 없어 장착할 수 있는지 확인하지 못했어요.",
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
          ...(memorySlotFormFactor.inferred
            ? [{ label: "슬롯 규격 판단 근거", actual: `${motherboard.specs.formFactor} 폼팩터/${motherboard.specs.socket} 데스크톱 소켓으로 DIMM 판단` }]
            : []),
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
        "메인보드와 RAM의 최대 용량을 확인해 주세요.",
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
        "메인보드 RAM 슬롯 수를 확인해 주세요.",
        "메인보드 RAM 슬롯 수 정보가 없어 꽂을 수 있는 모듈 수를 확인하지 못했어요.",
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

    // 슬롯당 상한은 제조사 표기가 아니라 최대 용량 ÷ 슬롯 수로 계산한 값이다. BIOS 업데이트로
    // 대용량 모듈을 지원하는 보드도 있어 warning까지만 낸다. 입력 누락은 위 용량/슬롯 규칙이 보고한다.
    if (maxMemoryGb !== undefined && memorySlots !== undefined && memorySlots > 0) {
      const perSlotLimitGb = maxMemoryGb / memorySlots;
      const oversizedModules = memory.filter(({ part }) => {
        const moduleCapacityGb = memoryModuleCapacityGb(part);
        return moduleCapacityGb !== undefined && moduleCapacityGb > perSlotLimitGb;
      });
      if (oversizedModules.length > 0) {
        addFinding(
          findings,
          "memory-module-capacity",
          "warning",
          "RAM 모듈 1개 용량이 메인보드 슬롯당 용량보다 큽니다.",
          "메인보드 최대 용량을 슬롯 수로 나눈 값보다 큰 모듈이라 인식되지 않을 수 있어요. 메인보드의 대용량 모듈 지원(BIOS 버전/QVL)을 확인해 주세요.",
          partIds(motherboard, ...oversizedModules.map(({ part }) => part)),
          [
            ...oversizedModules.map(({ part }) => ({ label: `${part.name} 모듈당 용량`, actual: formatNumber(memoryModuleCapacityGb(part), "GB") })),
            { label: "메인보드 슬롯당 용량(최대 용량 ÷ 슬롯 수)", expected: formatNumber(perSlotLimitGb, "GB") }
          ],
          [replaceAction("memory"), replaceAction("motherboard"), action("verify_spec", "메인보드 대용량 모듈 지원 확인", "motherboard")]
        );
      }
    }

    if (memoryModuleCount !== 2) {
      addFinding(
        findings,
        "memory-dual-channel",
        "warning",
        "RAM은 2개 구성으로 사용하는 것을 권장합니다.",
        "RAM을 두 개로 구성하면 메모리 대역폭을 더 잘 활용할 수 있어요. 현재 구성에서는 이 이점을 놓칠 수 있습니다.",
        partIds(...memory.map(({ part }) => part)),
        [{ label: "현재 RAM 물리 모듈 수", actual: formatNumber(memoryModuleCount, "개") }],
        [action("change_quantity", "RAM을 2개로 조정", "memory")]
      );
    }

    const cpuMemorySpeedRelevant = memory.some(({ part }) => (part.specs.memoryProfiles?.length ?? 0) > 0);
    const cpuMemorySpeedLimit = cpuMemorySpeedLimitFor(cpu, memory.find(({ part }) => part.specs.memoryType)?.part.specs.memoryType ?? motherboard.specs.memoryType);
    const memorySpeedLimits = [
      { label: "메인보드 지원 속도", value: motherboard.specs.maxMemorySpeedMhz },
      ...(cpuMemorySpeedRelevant ? [{ label: "CPU 공식 지원 속도", value: cpuMemorySpeedLimit }] : [])
    ].filter((limit): limit is { label: string; value: number } => limit.value !== undefined && limit.value > 0);
    const effectiveMemorySpeedLimit = memorySpeedLimits.length > 0
      ? Math.min(...memorySpeedLimits.map((limit) => limit.value))
      : undefined;
    const unsupportedSpeed = memory.filter(({ part }) => {
      return part.specs.speedMhz !== undefined && effectiveMemorySpeedLimit !== undefined && part.specs.speedMhz > effectiveMemorySpeedLimit;
    });
    const missingSpeedFields = [
      ...(motherboard.specs.maxMemorySpeedMhz === undefined ? ["motherboard supported memory speed"] : []),
      ...(cpuMemorySpeedRelevant && cpuMemorySpeedLimit === undefined ? ["CPU supported memory speed"] : []),
      ...(memory.some(({ part }) => part.specs.speedMhz === undefined) ? ["memory speed"] : [])
    ];
    const requiredMemorySpeedLimitCount = cpuMemorySpeedRelevant ? 2 : 1;
    if (memorySpeedLimits.length < requiredMemorySpeedLimitCount || memory.some(({ part }) => part.specs.speedMhz === undefined)) {
      // 지원 속도 상한이 없는 보드/CPU가 카탈로그 대부분이다 — 미확인을
      // unknown으로 두면 모든 견적이 needs_review가 되어 유효 조합이 사라진다.
      // 상한 미확인은 경고로만 남기고, 확인된 초과(아래 warning)만 지적한다.
      if (memory.some(({ part }) => part.specs.speedMhz === undefined)) {
        addUnknown(
          findings,
          "memory-speed",
          "RAM과 CPU/메인보드가 지원하는 속도를 확인해 주세요.",
          "메모리 속도 또는 CPU/메인보드의 공식 지원 속도 데이터가 부족합니다.",
          partIds(motherboard, ...memory.map(({ part }) => part)),
          missingSpeedFields.length > 0 ? missingSpeedFields : ["supported memory speed"],
          "memory"
        );
      } else {
        addFinding(
          findings,
          "memory-speed",
          "warning",
          "메인보드/CPU의 메모리 지원 속도 상한이 확인되지 않았습니다.",
          "상한 데이터가 없어 RAM이 JEDEC 기본 속도로 동작할 수 있습니다. 고속 킷이라면 제조사 스펙을 확인해 주세요.",
          partIds(motherboard, ...memory.map(({ part }) => part)),
          missingSpeedFields.length > 0 ? missingSpeedFields.map((field) => ({ label: "누락된 정보", actual: catalogMissingFieldLabelFor(field) })) : [{ label: "지원 속도 상한", expected: "확인 필요" }],
          [action("verify_spec", "메인보드 메모리 지원 확인", "motherboard")]
        );
      }
    } else if (unsupportedSpeed.length > 0) {
      addFinding(
        findings,
        "memory-speed",
        "warning",
        "RAM 속도가 CPU/메인보드의 확인된 지원 상한을 초과합니다.",
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
        "메인보드에서 RAM의 EXPO/XMP 설정을 지원하는지 확인해 주세요.",
        "메인보드의 EXPO/XMP 지원 정보가 없어 RAM의 고속 설정을 쓸 수 있는지 확인하지 못했어요. 두 제품 설명서를 비교해 주세요.",
        partIds(motherboard, ...profileMemory.map(({ part }) => part)),
        ["motherboard memory profiles"],
        "memory"
      );
    } else if (profileMismatch) {
      addFinding(
        findings,
        "memory-profile",
        "warning",
        "RAM의 EXPO/XMP 설정과 메인보드 지원 정보가 맞지 않습니다.",
        "RAM의 EXPO/XMP 설정이 메인보드 지원 정보와 맞지 않아 기본 속도로 동작하거나 직접 설정해야 할 수 있어요.",
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
        "M.2 SSD를 꽂을 메인보드 슬롯 수를 확인해 주세요.",
        "메인보드에 M.2 SSD를 몇 개까지 꽂을 수 있는지 확인하지 못했어요.",
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
        "M.2 SSD와 메인보드의 연결 방식이 맞는지 확인해 주세요.",
        "SSD 연결 방식(NVMe/SATA)이나 메인보드의 M.2 정보가 빠져 있어 서로 맞는지 확인하지 못했어요.",
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
          { label: "수동 지정 슬롯", actual: Object.keys(build.m2SlotSelection ?? {}).join(" / ") || "없음" }
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
        "M.2 SSD별 PCIe 연결 속도를 확인해 주세요.",
        "메인보드의 M.2 슬롯마다 PCIe 세대가 다르지만 SSD별 슬롯 배치가 정해지지 않아 속도와 레인 배분을 확인하지 못했어요.",
        partIds(motherboard, ...m2Parts.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "메인보드 확인 PCIe 세대", actual: motherboardM2PcieGenerations!.map(formatPcieGeneration).join(" / ") },
          { label: "확인 필요", actual: "M2_1/M2_2/M2_3별 PCIe 세대/CPU 직결/레인 공유" }
        ],
        [action("verify_spec", "M.2 슬롯별 세대/레인 확인", "motherboard")]
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
          { label: "등록된 M.2 슬롯", expected: m2SlotProfiles!.map((profile) => `${profile.slotId}: ${profile.interfaces!.join(" / ")}`).join(" / ") }
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
        "등록된 제조사 매뉴얼 기준으로 선택한 M.2 슬롯에 공유 대상이 있지만, 해당 대상이 언제 비활성화되거나 링크 폭을 바꾸는지까지는 자동으로 정하지 않아요.",
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
        "M.2 SSD를 쓰면 그래픽카드 연결에 영향이 있는지 확인해 주세요.",
        "메인보드 설명서에서 M.2 SSD 장착 시 그래픽카드 슬롯 속도가 바뀌거나 사용할 수 없게 되는지 확인해 주세요.",
        partIds(motherboard, gpu, ...ssds.map(({ part }) => part)),
        [
          { label: "선택한 M.2 SSD", actual: formatNumber(m2Count, "개") },
          { label: "GPU PCIe 장착 폭", actual: gpu.specs.pcieSlotWidth === undefined ? "확인 필요" : `x${gpu.specs.pcieSlotWidth}` },
          { label: "M.2 공유 범위", actual: m2LaneSharingScopes?.join(", ") ?? "PCIe" },
          { label: "메인보드 페이지 표기", actual: motherboard.specs.m2LaneSharingNote ?? "레인공유" }
        ],
        [action("verify_spec", "M.2/PCIe 슬롯 공유 확인", "motherboard")]
      );
    }

    if (hdds.length > 0) {
      const unknownHddInterfaces = hdds.filter(({ part }) => part.specs.interface === undefined);
      const unsupportedHddInterfaces = hdds.filter(({ part }) => part.specs.interface !== undefined && part.specs.interface !== "SATA");
      if (unknownHddInterfaces.length > 0) {
        addUnknown(
          findings,
          "hdd-interface",
          "HDD가 SATA 방식인지 확인해 주세요.",
          "HDD 정보에 SATA 연결인지 확인할 수 있는 표기가 없어 메인보드에 직접 연결 가능한지 확인해야 합니다.",
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
        "케이스에 HDD를 장착할 공간이 있는지 확인해 주세요.",
        "케이스의 HDD 장착 공간 정보가 없어 HDD가 들어가는지 확인하지 못했어요.",
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

  // 2.5인치 SSD는 트레이 뒷면/3.5인치 겸용 트레이/파워 덮개 위 등 장착 위치가 유연해 공간 부족이
  // 조립 불가로 이어지지 않는다. 케이스 SSD 베이 수가 확인될 때만, 남는 3.5인치 베이까지 더해 판정하고
  // 초과해도 warning까지만 낸다. 베이 수가 없으면 판정하지 않는다.
  const twoPointFiveInchSsds = ssds.filter(({ part }) => isTwoPointFiveInchStorage(part));
  const unknownFormFactorSsds = ssds.filter(({ part }) => !part.specs.formFactor && part.specs.interface !== "NVMe");
  const ssdBays = computerCase?.specs.ssdBays;
  if (computerCase && ssdBays !== undefined && (twoPointFiveInchSsds.length > 0 || unknownFormFactorSsds.length > 0)) {
    const ssdCount = twoPointFiveInchSsds.reduce((total, { selection }) => total + selection.quantity, 0);
    const unknownFormFactorCount = unknownFormFactorSsds.reduce((total, { selection }) => total + selection.quantity, 0);
    const twoPointFiveInchCapacity = twoPointFiveInchMountCapacity(computerCase, hdds);
    if (ssdCount > twoPointFiveInchCapacity) {
      addFinding(
        findings,
        "case-ssd-bays",
        "warning",
        "2.5인치 SSD를 장착할 공간이 부족할 수 있습니다.",
        "케이스의 SSD 베이와 남는 3.5인치 베이를 합쳐도 선택한 2.5인치 SSD보다 적어요. 변환 브라켓이나 별매 스토리지 키트로 장착할 수 있는지 케이스 제조사에서 확인해 주세요.",
        partIds(computerCase, ...twoPointFiveInchSsds.map(({ part }) => part)),
        [
          { label: "선택한 2.5인치 SSD", actual: formatNumber(ssdCount, "개") },
          { label: "케이스 SSD 베이", expected: formatNumber(ssdBays, "개") },
          { label: "2.5인치 장착 가능(남는 3.5인치 베이 포함)", expected: formatNumber(twoPointFiveInchCapacity, "개") }
        ],
        [action("change_quantity", "SSD 수량 줄이기", "ssd"), replaceAction("case")]
      );
    } else if (ssdCount + unknownFormFactorCount > twoPointFiveInchCapacity) {
      addUnknown(
        findings,
        "case-ssd-bays",
        "케이스에 2.5인치 SSD를 장착할 공간이 있는지 확인해 주세요.",
        "SSD의 폼팩터 정보가 없어 2.5인치 베이가 필요한지 확인하지 못했어요.",
        partIds(computerCase, ...twoPointFiveInchSsds.map(({ part }) => part), ...unknownFormFactorSsds.map(({ part }) => part)),
        ["SSD form factor"],
        "ssd"
      );
    }
  }

  if (motherboard && computerCase && motherboard.specs.formFactor) {
    const supported = computerCase.specs.motherboardFormFactors;
    if (!supported) {
      addUnknown(
        findings,
        "case-motherboard-form-factor",
        "메인보드가 케이스에 들어가는지 확인해 주세요.",
        "케이스가 지원하는 메인보드 크기 정보가 없어 장착할 수 있는지 확인하지 못했어요.",
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
    const motherboardFanPorts = caseFanHeaderCapacityFor(motherboard.specs, buildCoolerTypeFor(cooler?.specs, cpu?.specs));
    const caseFanHub = computerCase.specs.fanHubIncluded === true;
    if (caseFanCount !== undefined && caseFanCount > 0 && !caseFanHub && motherboardFanPorts === undefined) {
      addUnknown(
        findings,
        "case-fan-headers",
        "케이스 팬을 메인보드에 연결할 수 있는지 확인해 주세요.",
        "메인보드에 팬을 연결할 수 있는 단자 수가 확인되지 않았어요. 케이스에 팬 허브나 컨트롤러가 포함됐는지도 확인해 주세요.",
        partIds(motherboard, computerCase),
        ["motherboard fan headers"],
        "motherboard"
      );
    } else if (caseFanCount !== undefined && !caseFanHub && motherboardFanPorts !== undefined && caseFanCount > motherboardFanPorts) {
      addFinding(
        findings,
        "case-fan-headers",
        "warning",
        "케이스 팬을 모두 연결하기 어려울 수 있습니다.",
        "케이스 팬을 모두 메인보드에 연결하기 어려울 수 있어요. 팬 허브나 별도 컨트롤러가 포함됐는지 확인해 주세요.",
        partIds(motherboard, computerCase),
        [
          { label: "케이스 기본 팬", actual: formatNumber(caseFanCount, "개") },
          { label: "메인보드 팬 헤더", expected: formatNumber(motherboardFanPorts, "개") }
        ],
        [action("verify_spec", "팬 허브/컨트롤러 확인", "case")]
      );
    }
    // ARGB/RGB 헤더 하나에 분배 케이블이나 데이지 체인으로 여러 장치를 묶는 게
    // 일반적이고, 다나와는 헤더를 종류별로 한 번만 적는다. 장치 수가 헤더 수보다
    // 많은 것만으로는 경고하지 않고, 확인된 헤더가 하나도 없을 때만 경고한다.
    // 전압이 맞는지는 아래 case-rgb-voltage가 따로 판정한다.
    const caseRgbDevices = computerCase.specs.rgbDeviceCount;
    const motherboardRgbPorts = motherboard.specs.rgbPortCount;
    const caseRgbController = computerCase.specs.rgbControllerIncluded === true;
    if (caseRgbDevices !== undefined && caseRgbDevices > 0 && !caseRgbController && motherboardRgbPorts === undefined) {
      addUnknown(
        findings,
        "case-rgb-headers",
        "케이스 조명을 메인보드에 연결할 수 있는지 확인해 주세요.",
        "케이스 조명을 연결할 단자 수와 기본 컨트롤러 정보가 확인되지 않았어요. 케이스 설명서도 확인해 주세요.",
        partIds(motherboard, computerCase),
        ["motherboard RGB/ARGB headers"],
        "motherboard"
      );
    } else if (caseRgbDevices !== undefined && caseRgbDevices > 0 && !caseRgbController && motherboardRgbPorts === 0) {
      addFinding(
        findings,
        "case-rgb-headers",
        "warning",
        "케이스 조명을 메인보드에 연결할 단자가 없습니다.",
        "메인보드에 RGB/ARGB 헤더가 없어 케이스 조명을 직접 연결할 수 없어요. 별도 RGB 컨트롤러가 필요합니다.",
        partIds(motherboard, computerCase),
        [
          { label: "케이스 RGB 장치", actual: formatNumber(caseRgbDevices, "개") },
          { label: "메인보드 RGB/ARGB 헤더", expected: formatNumber(motherboardRgbPorts, "개") }
        ],
        [action("verify_spec", "RGB 허브/전압 확인", "motherboard")]
      );
    }
    const caseRgbVoltage = computerCase.specs.rgbDeviceVoltage;
    if (caseRgbDevices !== undefined && caseRgbDevices > 0 && !caseRgbController && caseRgbVoltage) {
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
          "케이스 조명과 메인보드의 연결 규격을 확인해 주세요.",
          "메인보드의 조명 연결 규격 정보가 없어 안전하게 연결할 수 있는지 확인하기 어려워요. 케이스와 메인보드 설명서를 비교해 주세요.",
          partIds(motherboard, computerCase),
          ["motherboard RGB header voltage"],
          "motherboard"
        );
      } else if (missingVoltageHeaders.length > 0) {
        addFinding(
          findings,
          "case-rgb-voltage",
          "warning",
          "케이스 조명과 메인보드의 연결 규격이 맞지 않을 수 있습니다.",
          "케이스 조명에 맞는 메인보드 단자가 확인되지 않았어요. 5V ARGB와 12V RGB는 서로 연결하면 안 됩니다. 전용 컨트롤러를 쓴다면 제품 설명서에서 전압을 확인해 주세요.",
          partIds(motherboard, computerCase),
          [
            { label: "케이스 RGB 전압", actual: caseRgbVoltage === "mixed" ? "5V + 12V" : caseRgbVoltage },
            { label: "메인보드 5V ARGB 헤더", actual: formatNumber(motherboard.specs.rgb5vPortCount, "개") },
            { label: "메인보드 12V RGB 헤더", actual: formatNumber(motherboard.specs.rgb12vPortCount, "개") }
          ],
          [action("verify_spec", "RGB 컨트롤러/전압 확인", "motherboard")]
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
        "CPU 쿨러가 CPU 소켓에 맞는지 확인해 주세요.",
        "쿨러 브래킷 정보가 없어 CPU에 장착할 수 있는지 확인하지 못했어요.",
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
        "CPU의 전력/발열 수준에 비해 쿨러 여유가 부족할 수 있습니다.",
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
          "케이스가 수랭 쿨러의 라디에이터 크기를 지원하는지 확인해 주세요.",
          "라디에이터 크기나 케이스의 지원 정보가 없어 장착할 수 있는지 확인하지 못했어요.",
          partIds(cooler, computerCase),
          [radiatorSize === undefined ? "radiator size" : "case radiator support"],
          "case"
        );
      } else if (radiatorSupports.length > 0 && coolerPosition === undefined) {
        addFinding(
          findings,
          "case-radiator-support",
          "unknown",
          "수랭 쿨러 라디에이터를 케이스 어느 위치에 달 수 있는지 확인해 주세요.",
          "케이스가 지원하는 위치는 확인했지만 쿨러의 장착 위치가 표시되지 않았어요. 제품 설명서를 확인해 주세요.",
          partIds(cooler, computerCase),
          [
            { label: "라디에이터 크기", actual: formatNumber(radiatorSize, "mm") },
            { label: "케이스 지원 위치", expected: radiatorSupports.map((support) => `${radiatorPositionLabel(support.position)}: ${support.sizesMm.map((size) => `${size}mm`).join(", ")}`).join(" / ") },
            { label: "쿨러 장착 위치", actual: "확인 필요" }
          ],
          [action("verify_spec", "쿨러 라디에이터 장착 위치 확인", "cooler"), replaceAction("cooler")]
        );
      } else if (radiatorSupports.length > 0 && (!positionSupport || !positionSupport.sizesMm.includes(radiatorSize))) {
        addFinding(
          findings,
          "case-radiator-support",
          "blocker",
          "수랭 쿨러의 라디에이터 위치/크기를 케이스가 지원하지 않습니다.",
          "선택한 쿨러의 라디에이터를 같은 위치와 규격으로 케이스에 장착할 수 없습니다.",
          partIds(cooler, computerCase),
          [
            { label: "쿨러 라디에이터", actual: `${radiatorPositionLabel(coolerPosition ?? "확인 필요")} / ${formatNumber(radiatorSize, "mm")}` },
            { label: "케이스 해당 위치 지원", expected: positionSupport ? positionSupport.sizesMm.map((size) => `${size}mm`).join(", ") : "해당 위치 지원 정보 없음" },
            { label: "케이스 전체 위치 지원", expected: radiatorSupports.map((support) => `${radiatorPositionLabel(support.position)}: ${support.sizesMm.map((size) => `${size}mm`).join(", ")}`).join(" / ") }
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
      } else if (positionSupport) {
        const clearanceFindings = radiatorClearanceFindings(positionSupport, radiatorSize, cooler, memory.map(({ part }) => part), gpu);
        if (clearanceFindings.length > 0) {
          const blocked = clearanceFindings.some((finding) => finding.severity === "blocker");
          addFinding(
            findings,
            "case-radiator-support",
            blocked ? "blocker" : "unknown",
            blocked ? "수랭 라디에이터의 장착 공간이 부족합니다." : "수랭 라디에이터의 치수와 설치 조건을 확인해 주세요.",
            blocked ? "실제 부품 치수가 제조사의 장착 한도를 초과합니다." : "제조사가 지정한 치수나 조립 조건을 아직 확인하지 못했어요. 크기와 위치만으로 장착 가능 여부를 확정할 수 없습니다.",
            partIds(cooler, computerCase, ...memory.map(({ part }) => part), gpu),
            clearanceFindings.map(({ label, actual, expected }) => ({ label, actual, expected })),
            blocked
              ? [replaceAction("cooler"), replaceAction("case"), ...(clearanceFindings.some((finding) => finding.label === "RAM 높이" && finding.severity === "blocker") ? [replaceAction("memory")] : []), ...(clearanceFindings.some((finding) => finding.label === "그래픽카드 길이" && finding.severity === "blocker") ? [replaceAction("gpu")] : [])]
              : [action("verify_spec", "쿨러와 케이스 설치 조건 확인", "cooler"), ...(clearanceFindings.some((finding) => finding.label === "RAM 높이") ? [action("verify_spec", "RAM 높이 확인", "memory")] : [])]
          );
        }
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
    } else if (cpu && cpuHasIntegratedGraphics(cpu) === false) {
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
    } else if (cpu && cpuHasIntegratedGraphics(cpu) === undefined) {
      addUnknown(
        findings,
        "display-output",
        "CPU에 내장 그래픽이 있는지 확인해 주세요.",
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
        "그래픽카드가 케이스에 들어가는지 확인해 주세요.",
        "그래픽카드 길이나 케이스 안쪽 길이 정보가 없어 들어가는지 확인하지 못했어요.",
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
    if (computerCase.specs.lowProfileOnly === true) {
      if (gpu.specs.lowProfileBracket === false) {
        addFinding(
          findings,
          "gpu-case-low-profile",
          "blocker",
          "로우프로파일 브라켓이 없는 그래픽카드입니다.",
          "슬림(LP 전용) 케이스에는 로우프로파일 브라켓이 있는 그래픽카드만 장착할 수 있습니다.",
          partIds(gpu, computerCase),
          [
            { label: "케이스 슬롯 규격", expected: "로우프로파일 전용" },
            { label: "그래픽카드 LP 브라켓", actual: "없음" }
          ],
          [replaceAction("case"), replaceAction("gpu")]
        );
      } else if (gpu.specs.lowProfileBracket === undefined) {
        addFinding(
          findings,
          "gpu-case-low-profile",
          "warning",
          "슬림 케이스 — 그래픽카드 LP 브라켓 여부를 확인해 주세요.",
          "선택한 케이스는 로우프로파일 슬롯 전용인데, 이 그래픽카드의 LP 브라켓 포함 여부가 등록되어 있지 않습니다.",
          partIds(gpu, computerCase),
          [
            { label: "케이스 슬롯 규격", actual: "로우프로파일 전용" },
            { label: "그래픽카드 LP 브라켓", actual: "확인 필요" }
          ],
          [action("verify_spec", "GPU LP 브라켓 포함 여부 확인", "gpu"), replaceAction("gpu")]
        );
      }
    }
    const gpuThickness = gpu.specs.thicknessMm;
    if (gpuThickness === undefined) {
      addUnknown(
        findings,
        "gpu-thickness",
        "그래픽카드 주변 공간을 확인해 주세요.",
        "그래픽카드 두께 정보가 없어 옆 슬롯을 가리는지 확인하기 어려워요. 제품 크기와 케이스 안쪽 공간을 확인해 주세요.",
        partIds(gpu, computerCase, motherboard),
        ["GPU thickness"],
        "case"
      );
    } else {
      // 두꺼운 카드는 아래 확장 슬롯을 덮지만, 그 슬롯에 다른 카드를 꽂지 않는
      // 게이밍 구성에서는 문제가 아니다. 케이스 확장 슬롯 공간이 실제로 부족할 수
      // 있는 경우(ITX 전용 케이스, mATX까지만 받는 케이스)만 경고한다.
      const caseBoardForms = computerCase.specs.motherboardFormFactors ?? [];
      const caseSlotLimit = caseBoardForms.includes("ATX") || caseBoardForms.includes("E-ATX")
        ? undefined
        : caseBoardForms.includes("mATX")
          ? { label: "mATX 케이스 확장 슬롯 공간", warningMm: 4 * PCIE_SLOT_PITCH_MM }
          : caseBoardForms.includes("ITX")
            ? { label: "ITX 케이스 확장 슬롯 공간", warningMm: GPU_THICKNESS_WARNING_MM }
            : { label: "케이스 확장 슬롯 공간", warningMm: GPU_THICKNESS_WARNING_MM };
      const coveredSlots = Math.max(0, Math.ceil(gpuThickness / PCIE_SLOT_PITCH_MM - 0.05) - 1);
      if (caseSlotLimit && gpuThickness >= caseSlotLimit.warningMm) {
        addFinding(
          findings,
          "gpu-thickness",
          "warning",
          "그래픽카드가 두꺼워 케이스에 들어가지 않을 수 있습니다.",
          "작은 케이스는 확장 슬롯 공간이 좁아 두꺼운 그래픽카드가 들어가지 않을 수 있어요. 케이스가 지원하는 그래픽카드 두께(슬롯 수)를 확인해 주세요.",
          partIds(gpu, computerCase, motherboard),
          [
            { label: "그래픽카드 두께", actual: formatNumber(gpuThickness, "mm") },
            { label: caseSlotLimit.label, expected: formatNumber(Math.round(caseSlotLimit.warningMm), "mm 미만") }
          ],
          [action("verify_spec", "GPU 두께/슬롯 간격 확인", "case")]
        );
      } else if (gpuThickness >= GPU_THICKNESS_WARNING_MM) {
        addFinding(
          findings,
          "gpu-thickness",
          "info",
          "그래픽카드가 아래 확장 슬롯을 덮습니다.",
          `그래픽카드 아래 확장 슬롯 ${coveredSlots}개를 쓸 수 없어요. 다른 확장 카드를 꽂을 계획이 없다면 문제없습니다.`,
          partIds(gpu, computerCase, motherboard),
          [
            { label: "그래픽카드 두께", actual: formatNumber(gpuThickness, "mm") },
            { label: "덮는 확장 슬롯", actual: formatNumber(coveredSlots, "개") }
          ],
          []
        );
      }
    }
    const gpuCableBendClearance = gpu.specs.gpuCableBendClearanceMm;
    const caseSidePanelClearance = computerCase.specs.caseSidePanelClearanceMm;
    if (gpuCableBendClearance !== undefined || caseSidePanelClearance !== undefined) {
      if (gpuCableBendClearance === undefined || caseSidePanelClearance === undefined) {
        addFinding(
          findings,
          "gpu-cable-clearance",
          "unknown",
          "그래픽카드 전원 케이블을 꽂을 공간을 확인해 주세요.",
          "전원 케이블이 꺾일 공간이나 케이스 옆면까지의 거리 정보가 없어 간섭 여부를 확인하지 못했어요.",
          partIds(gpu, computerCase),
          [
            { label: "GPU 케이블 굽힘 여유", actual: gpuCableBendClearance === undefined ? "확인 필요" : formatNumber(gpuCableBendClearance, "mm") },
            { label: "케이스 측면 케이블 여유", actual: caseSidePanelClearance === undefined ? "확인 필요" : formatNumber(caseSidePanelClearance, "mm") }
          ],
          [action("verify_spec", "GPU/케이스 케이블 여유 확인", "case")]
        );
      } else if (caseSidePanelClearance < gpuCableBendClearance) {
        addFinding(
          findings,
          "gpu-cable-clearance",
          "blocker",
          "GPU 전원 케이블 측면 여유가 부족합니다.",
          "확인된 GPU 케이블 굽힘 요구 여유보다 케이스 측면 공간이 작아 전원 케이블이 측판과 간섭할 수 있습니다.",
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
        "파워가 케이스에 들어가는지 확인해 주세요.",
        "파워 깊이나 케이스 안쪽 공간 정보가 빠져 있어 들어가는지 확인하지 못했어요. 두 제품의 길이를 확인해 주세요.",
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
        "파워 규격이 케이스와 맞는지 확인해 주세요.",
        "파워나 케이스의 크기 규격 정보가 없어 서로 맞는지 확인하지 못했어요.",
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

  if (!gpu && psu && cpu) {
    // 외장 GPU가 없는 구성도 CPU 전력 + 기본 시스템 부하로 파워 용량을 확인한다(CompatPC 950).
    // 예상 부하는 추정값이라 warning까지만 낸다.
    const cpuLoadW = cpu.specs.pptW ?? cpu.specs.tdpW;
    const psuWattage = psu.specs.wattageW;
    if (cpuLoadW === undefined || psuWattage === undefined) {
      addUnknown(
        findings,
        "psu-system-power",
        "파워가 시스템 전력을 공급할 수 있는지 확인해 주세요.",
        "CPU 전력이나 파워 정격 출력 정보가 없어 전력 여유를 확인하지 못했어요.",
        partIds(cpu, psu),
        [cpuLoadW === undefined ? "CPU power" : "", psuWattage === undefined ? "PSU wattage" : ""].filter(Boolean),
        "psu"
      );
    } else {
      // CompatPC처럼 예상 부하의 1.2배 경계값까지 경고 구간에 포함한다.
      const estimatedLoadW = PSU_LOAD_HEADROOM_RATIO * (cpuLoadW + SYSTEM_BASE_LOAD_W);
      if (psuWattage <= estimatedLoadW * PSU_LOAD_HEADROOM_RATIO) {
        addFinding(
          findings,
          "psu-system-power",
          "warning",
          psuWattage < estimatedLoadW
            ? "파워 용량이 예상 시스템 전력보다 부족할 수 있습니다."
            : "파워 용량 여유가 크지 않습니다.",
          "CPU 전력과 기본 시스템 부하로 추정한 결과예요. 장시간 고부하에서 불안정하거나 소음/발열이 커질 수 있으니 더 높은 정격 출력의 파워를 권장합니다.",
          partIds(cpu, psu),
          [
            { label: "CPU 기준 전력", actual: formatNumber(cpuLoadW, "W") },
            { label: "예상 시스템 부하(추정)", expected: formatEstimatedWatts(estimatedLoadW) },
            { label: "추정 근거", actual: `(CPU 전력 + 기본 ${SYSTEM_BASE_LOAD_W}W) × ${PSU_LOAD_HEADROOM_RATIO}` },
            { label: "선택한 파워 용량", actual: formatNumber(psuWattage, "W") }
          ],
          [replaceAction("psu")]
        );
      }
    }
  }

  if (gpu && psu) {
    const gpuPower = gpu.specs.powerW;
    const cpuPower = cpu?.specs.pptW ?? cpu?.specs.tdpW ?? 0;
    const cpuLoadW = cpu?.specs.pptW ?? cpu?.specs.tdpW;
    const psuWattage = psu.specs.wattageW;
    const recommendedPsu = gpu.specs.recommendedPsuW ?? (gpuPower === undefined ? undefined : gpuPower + cpuPower + 150);
    if (psuWattage !== undefined && recommendedPsu !== undefined && psuWattage < recommendedPsu) {
      addFinding(
        findings,
        "gpu-psu-power",
        "blocker",
        "파워서플라이 용량이 부족합니다.",
        "그래픽카드와 시스템의 권장 전력보다 낮은 파워서플라이가 선택되었습니다.",
        partIds(gpu, psu, cpu),
        [
          ...(gpuPower !== undefined ? [{ label: "그래픽카드 소비전력", actual: formatNumber(gpuPower, "W") }] : []),
          { label: "권장 파워 용량", expected: formatNumber(recommendedPsu, "W") },
          { label: "선택한 파워 용량", actual: formatNumber(psuWattage, "W") }
        ],
        [replaceAction("psu"), replaceAction("gpu")]
      );
    } else if (gpuPower === undefined || psuWattage === undefined || recommendedPsu === undefined) {
      const missingFields = [
        ...(gpuPower === undefined ? ["GPU power"] : []),
        ...(recommendedPsu === undefined ? ["recommended PSU wattage"] : []),
        ...(psuWattage === undefined ? ["PSU wattage"] : [])
      ];
      addFinding(
        findings,
        "gpu-psu-power",
        "unknown",
        "그래픽카드에 필요한 전력을 파워가 공급할 수 있는지 확인해 주세요.",
        "일부 전력 정보가 없어 실제 전력 여유를 확인하지 못했어요.",
        partIds(gpu, psu, cpu),
        [
          ...(gpuPower !== undefined ? [{ label: "그래픽카드 소비전력", actual: formatNumber(gpuPower, "W") }] : []),
          ...(recommendedPsu !== undefined ? [{ label: "권장 파워 용량", expected: formatNumber(recommendedPsu, "W") }] : []),
          ...(psuWattage !== undefined ? [{ label: "선택한 파워 용량", actual: formatNumber(psuWattage, "W") }] : []),
          ...missingFields.map((field) => ({ label: "누락된 정보", actual: catalogMissingFieldLabelFor(field) }))
        ],
        [action("verify_spec", psuWattage === undefined ? "파워 스펙 확인" : "그래픽카드 스펙 확인", psuWattage === undefined ? "psu" : "gpu")]
      );
    } else if (cpuLoadW !== undefined) {
      // 권장 파워는 통과했지만 실제 CPU 전력을 반영한 예상 부하 대비 여유가 20% 미만이면 경고한다(CompatPC 950).
      // GPU 권장 파워에 포함된 기본 시스템 몫(300W)을 빼고 CPU 전력 × 1.2를 더한 추정 부하다.
      const estimatedLoadW = gpu.specs.recommendedPsuW !== undefined
        ? gpu.specs.recommendedPsuW - GPU_RECOMMENDED_PSU_SYSTEM_ALLOWANCE_W + cpuLoadW * PSU_LOAD_HEADROOM_RATIO
        : gpuPower + PSU_LOAD_HEADROOM_RATIO * (cpuLoadW + SYSTEM_BASE_LOAD_W);
      if (psuWattage <= estimatedLoadW * PSU_LOAD_HEADROOM_RATIO) {
        addFinding(
          findings,
          "gpu-psu-power",
          "warning",
          psuWattage < estimatedLoadW
            ? "CPU 전력을 반영하면 파워 용량이 부족할 수 있습니다."
            : "파워 용량 여유가 크지 않습니다.",
          "그래픽카드 권장 파워는 충족하지만 선택한 CPU 전력을 반영해 추정한 부하 대비 여유가 적어요. 장시간 고부하나 오버클럭에서는 더 높은 정격 출력의 파워를 권장합니다.",
          partIds(gpu, psu, cpu),
          [
            { label: "그래픽카드 소비전력", actual: formatNumber(gpuPower, "W") },
            { label: "CPU 기준 전력", actual: formatNumber(cpuLoadW, "W") },
            { label: "예상 시스템 부하(추정)", expected: formatEstimatedWatts(estimatedLoadW) },
            {
              label: "추정 근거",
              actual: gpu.specs.recommendedPsuW !== undefined
                ? `GPU 권장 파워 − ${GPU_RECOMMENDED_PSU_SYSTEM_ALLOWANCE_W}W + CPU 전력 × ${PSU_LOAD_HEADROOM_RATIO}`
                : `GPU 소비전력 + (CPU 전력 + 기본 ${SYSTEM_BASE_LOAD_W}W) × ${PSU_LOAD_HEADROOM_RATIO}`
            },
            { label: "선택한 파워 용량", actual: formatNumber(psuWattage, "W") }
          ],
          [replaceAction("psu")]
        );
      }
    }

    const gpuPowerOptions = gpu.specs.pciePowerOptions;
    const psuPowerConnectors = psu.specs.pciePowerConnectors;
    if (gpuPowerOptions?.length === 0) {
      // The GPU explicitly declares that it has no auxiliary PCIe power requirement.
    } else if (!gpuPowerOptions && !psuPowerConnectors) {
      addUnknown(
        findings,
        "gpu-psu-connector",
        "그래픽카드와 파워의 보조전원 단자를 확인해 주세요.",
        "그래픽카드와 파워의 보조전원 단자 정보가 빠져 케이블을 연결할 수 있는지 확인하지 못했어요.",
        partIds(gpu, psu),
        ["GPU PCIe power connector", "PSU PCIe power connectors"],
        "psu"
      );
    } else if (!gpuPowerOptions) {
        addUnknown(
          findings,
          "gpu-psu-connector",
          "그래픽카드에 필요한 보조전원 단자를 확인해 주세요.",
          "파워 단자는 확인했지만 그래픽카드에 필요한 PCIe 보조전원 단자 정보가 없어요.",
          partIds(gpu, psu),
          ["GPU PCIe power connector"],
          "gpu"
        );
      } else if (!psuPowerConnectors) {
        addUnknown(
          findings,
          "gpu-psu-connector",
          "파워에서 제공하는 보조전원 단자를 확인해 주세요.",
          "그래픽카드에 필요한 PCIe 보조전원은 확인했지만 파워에서 제공하는 단자 정보가 없어요.",
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
            "그래픽카드와 파워의 보조전원 단자를 확인해 주세요.",
            "커넥터나 변환 어댑터 정보가 일부 빠져 있어 연결할 수 있는지 확인하지 못했어요. 필요한 단자와 어댑터를 제품 설명서에서 비교해 주세요.",
            partIds(gpu, psu),
            [
              { label: "GPU 요구 전원", actual: formatPciePowerOptions(gpuPowerOptions) },
              { label: "PSU 확인 커넥터", actual: formatPciePowerConnectors(psuPowerConnectors) }
            ],
            [action("verify_spec", "보조전원 커넥터 정보 확인", "psu")]
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
                { label: "확인된 독립 PCIe 케이블 런", actual: pcieCableRuns === undefined ? "확인 필요" : `${pcieCableRuns}개` },
                { label: "확인된 분배 구조", actual: pcieCableTopology === "shared" ? "분배/공유 케이블" : pcieCableTopology === "independent" ? "독립 케이블" : "확인 필요" }
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
      "파워의 빠진 사양을 확인해 주세요.",
      "전력 공급을 확인하는 데 필요한 사양이 빠져 있어요. 아래 항목을 제품 설명서에서 확인해 주세요.",
      [psu.id],
      psu.missingFields.map((field) => ({ label: "확인되지 않은 항목", actual: catalogMissingFieldLabelFor(field) })),
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
    ? analyzeBuild(build, catalog, metrics, orderedFindings, analysisProfile, analysisResolution, analysisRefreshRate, options.recommendationPreferences?.gamingGameIds)
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
    benchmarkSnapshot: buildBenchmarkSnapshotFor(cpu, gpu),
    links: compatibilityLinks,
    totalPriceWon: priceInfo.total,
    priceComplete: priceInfo.complete,
    engineVersion: ENGINE_VERSION,
    catalogSnapshotAt: options.catalogSnapshotAt ?? evaluatedAt ?? new Date().toISOString(),
    checkedAt: evaluatedAt ?? new Date().toISOString()
  };

  if (options.includeSuggestions !== false) {
    result.recommendationPreferences = options.recommendationPreferences;
    result.repairPlans = buildRepairPlans(result, build, catalog, options.recommendationPreferences, evaluationCache, recommendationSearchContext);
    attachSuggestions(result, build, catalog, evaluationCache, recommendationSearchContext);
    const rankedUpgrades = rankedUpgradeRecommendations(
      build,
      catalog,
      options.recommendationPreferences?.profile ?? "general",
      options.recommendationPreferences?.listingPolicy ?? "retail_only",
      options.recommendationPreferences?.priority ?? "balanced",
      analysisResolution,
      options.recommendationPreferences?.budgetWon,
      evaluationCache,
      analysisRefreshRate
    );
    const upgradeRecommendations = limitUpgradeRecommendations(rankedUpgrades);
    if (upgradeRecommendations.length > 0) result.upgradeRecommendations = upgradeRecommendations;
    const bundleCandidateRecommendations = limitUpgradeRecommendations(rankedUpgrades, { maxPerCategory: BUNDLE_CANDIDATE_MAX_PER_CATEGORY, maxTotal: BUNDLE_CANDIDATE_MAX_TOTAL });
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

function hasNumericPerformanceDimension(part: Part) {
  return Object.values(performanceDimensions(part)).some((value) => typeof value === "number");
}

// 분석 점수는 카탈로그 전체 범주를 정규화하므로 호환 검사마다(대체/업그레이드
// 후보 평가 포함) 다시 계산하면 비싸다. 카탈로그 배열 참조별로 짧게 캐시한다 —
// 벤치마크 유효기간은 일 단위라 수십 초 재사용은 점수를 바꾸지 않는다.
const CATALOG_OBJECTIVE_SCORE_TTL_MS = 60_000;
const catalogObjectiveScoreCache = new WeakMap<readonly Part[], Map<string, { computedAt: number; scores: Map<string, ObjectiveScore> }>>();

function catalogObjectiveScores(catalog: Part[], category: PartCategory, profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  const now = Date.now();
  let byKey = catalogObjectiveScoreCache.get(catalog);
  if (!byKey) {
    byKey = new Map();
    catalogObjectiveScoreCache.set(catalog, byKey);
  }
  const key = `${category}|${profile}|${gamingResolution}|${gamingRefreshRate}`;
  const cached = byKey.get(key);
  if (cached && now - cached.computedAt >= 0 && now - cached.computedAt < CATALOG_OBJECTIVE_SCORE_TTL_MS) return cached.scores;
  const scored = catalog.filter((candidate) => candidate.category === category && candidate.dataQuality !== "incomplete" && hasNumericPerformanceDimension(candidate));
  const scores = generatorObjectiveScores(scored, profile, gamingResolution, gamingRefreshRate, undefined, undefined, now);
  byKey.set(key, { computedAt: now, scores });
  return scores;
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
      summary: `고정 기준 성능 지수에서 CPU ${cpuScore}점 / GPU ${gpuScore}점으로 차이가 ${gap}점입니다. 큰 한쪽 쏠림 없이 균형 범위로 봅니다.`
    };
  }
  if (difference > 0) {
    return {
      cpuScore,
      gpuScore,
      gap,
      status: "cpu_limited",
      summary: `고정 기준 성능 지수에서 GPU ${gpuScore}점이 CPU ${cpuScore}점보다 ${gap}점 높습니다. 작업/게임에 따라 CPU 쪽을 먼저 비교할 여지가 있습니다.`
    };
  }
  return {
    cpuScore,
    gpuScore,
    gap,
    status: "gpu_limited",
    summary: `고정 기준 성능 지수에서 CPU ${cpuScore}점이 GPU ${gpuScore}점보다 ${gap}점 높습니다. 고해상도/그래픽 작업에 따라 GPU 쪽을 먼저 비교할 여지가 있습니다.`
  };
}

function buildAnalysisInsightsFor(factors: BuildAnalysisFactor[], profile: RecommendationProfile) {
  const scored = factors.filter((factor): factor is BuildAnalysisFactor & { score: number } => factor.score !== undefined);
  const toInsight = (factor: BuildAnalysisFactor & { score: number }, kind: "strength" | "focus"): BuildAnalysisInsight => ({
    category: factor.category,
    score: factor.score,
    title: kind === "strength" ? `${CATEGORY_LABELS[factor.category]} 강점` : `${CATEGORY_LABELS[factor.category]} 보완`,
    summary: kind === "strength"
      ? `${RECOMMENDATION_PROFILE_LABELS[profile]} 기준에서 고정 기준 성능 지수 ${factor.score}점으로 강점입니다.`
      : `${RECOMMENDATION_PROFILE_LABELS[profile]} 기준에서 고정 기준 성능 지수 ${factor.score}점으로 먼저 비교할 영역입니다.`
  });
  const strengths = [...scored]
    .filter((factor) => factor.score >= 75)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((factor) => toInsight(factor, "strength"));
  // 보완 영역은 성능이 실제로 갈리는 부품에 한정한다 — 용량 부품(SSD/HDD/케이스)
  // 은 고정 기준 지수가 구조적으로 낮아 약한 CPU보다 먼저 잡히는 문제가 있다.
  const PERFORMANCE_FOCUS_CATEGORIES = new Set<PartCategory>(["cpu", "gpu", "memory", "cooler", "motherboard"]);
  const focusCandidates = [...scored]
    .filter((factor) => factor.score < 60 && PERFORMANCE_FOCUS_CATEGORIES.has(factor.category))
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
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE,
  gamingGameIds: readonly string[] = []
): BuildAnalysis {
  const factors: BuildAnalysisFactor[] = [];
  const scoreMaps = new Map<PartCategory, Map<string, ObjectiveScore>>();
  for (const category of PART_CATEGORIES) {
    const entries = categorySelections(build, category)
      .map((selection) => ({ selection, part: selectedPart(catalog, selection) }))
      .filter((entry): entry is { selection: PartSelection; part: Part } => Boolean(entry.part));
    if (entries.length === 0) continue;
    const scoreMap = scoreMaps.get(category) ?? catalogObjectiveScores(catalog, category, profile, gamingResolution, gamingRefreshRate);
    scoreMaps.set(category, scoreMap);
    const scored = entries
      .map(({ selection, part }) => ({ objective: part.dataQuality === "incomplete" ? undefined : scoreMap.get(part.id), quantity: selection.quantity }))
      .filter((entry): entry is { objective: ObjectiveScore; quantity: number } => entry.objective?.score !== undefined);
    const score = scored.length > 0
      ? Math.round(scored.reduce((total, entry) => total + (entry.objective.score ?? 0) * entry.quantity, 0) / scored.reduce((total, entry) => total + entry.quantity, 0))
      : undefined;
    const weight = GENERATOR_CATEGORY_WEIGHTS[profile][category] ?? 1;
    const basisLabel = scored.every((entry) => entry.objective.basis === "benchmark")
      ? "측정 벤치마크 기준"
      : scored.every((entry) => entry.objective.basis === "none")
        ? "고정 목표 기준"
        : "확인 스펙 포함 기준";
    factors.push({
      category,
      label: CATEGORY_LABELS[category],
      score,
      weight,
      basis: score === undefined
        ? "비교 가능한 확인 스펙이 부족합니다."
        : `고정 기준 성능 지수 ${score}점 / ${basisLabel}${entries.length > 1 ? " / 선택 수량 반영" : ""}`
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
  const cpuGpuBalance = cpuGpuBalanceFor(currentCategoryPart(catalog, build, "cpu"), currentCategoryPart(catalog, build, "gpu"), currentCategoryPart(catalog, build, "motherboard")?.specs.memoryType, gamingGameIds);
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
      message: "호환성은 별도로 통과했지만 게임 옵션/텍스처 설정에 따라 선택한 해상도에서 VRAM 여유가 부족할 수 있습니다.",
      actual: `현재 ${formatTargetVram(gpuTarget.currentVramGb)}`,
      limit: `${GAMING_RESOLUTION_LABELS[gpuTarget.resolution]} 권장 ${gpuTarget.targetVramGb}GB`,
      action: "권장 VRAM을 충족하는 GPU 부품 비교"
    });
  }
  if (gpuTarget?.currentFit === "unknown") {
    addSignal({
      id: "gpu-target-vram-unknown",
      severity: "info",
      category: "gpu",
      title: "선택한 해상도의 GPU VRAM을 확인해야 합니다.",
      message: "카탈로그에 VRAM이 없어 해상도별 권장 기준 충족 여부를 정하지 않아요.",
      actual: "현재 VRAM 확인 불가",
      limit: `${GAMING_RESOLUTION_LABELS[gpuTarget.resolution]} 권장 ${gpuTarget.targetVramGb}GB`,
      action: "GPU 제조사 페이지에서 VRAM 확인"
    });
  }
  // AI/편집 작업도 VRAM이 치명적이다 — 로컬 모델 적재/GPU 가속 해상도 작업에서
  // VRAM 부족은 작업 자체가 안 되는 하드 한계라 게이밍과 같은 방식으로 표면화한다.
  if ((profile === "development" || profile === "creator") && currentGpu) {
    const workloadVramGb = currentGpu.specs.vramGb;
    const label = profile === "development" ? "로컬 AI/개발 작업" : "4K 편집/GPU 가속 작업";
    if (workloadVramGb !== undefined && workloadVramGb < 16) {
      addSignal({
        id: "gpu-workload-vram",
        severity: "warning",
        category: "gpu",
        title: `${label}에는 VRAM 여유가 부족할 수 있습니다.`,
        message: "호환성은 통과했지만 이 작업은 VRAM이 작업 가능성을 가릅니다. 큰 모델/고해상도 작업을 계획하면 VRAM 16GB 이상 부품을 비교해 보세요.",
        actual: `현재 VRAM ${workloadVramGb}GB`,
        limit: "권장 16GB 이상",
        action: "VRAM 16GB 이상 GPU 부품 비교"
      });
    } else if (workloadVramGb === undefined) {
      addSignal({
        id: "gpu-workload-vram-unknown",
        severity: "info",
        category: "gpu",
        title: `${label}에 맞는 VRAM인지 확인이 필요합니다.`,
        message: "카탈로그에 VRAM 정보가 없어 이 작업의 권장 기준 충족 여부를 정하지 않아요.",
        actual: "현재 VRAM 확인 불가",
        limit: "권장 16GB 이상",
        action: "GPU 제조사 페이지에서 VRAM 확인"
      });
    }
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
      message: "추가 SATA SSD/HDD를 연결할 포트 여유가 없습니다.",
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
      message: "현재는 장착 범위를 통과하지만 전면 팬/라디에이터와 간섭할 여지를 확인해야 합니다.",
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
      action: "쿨러/케이스 간섭 확인"
    });
  }
  if (metrics.coolerHeadroomW !== undefined && metrics.coolerHeadroomW < 50 && !hasRule("cpu-cooler-capacity")) {
    addSignal({
      id: "cooler-capacity-headroom",
      severity: metrics.coolerHeadroomW < 0 ? "critical" : "warning",
      category: "cooler",
      title: "CPU 쿨러 냉각 여유가 좁습니다.",
      message: "호환 기준은 통과했지만 고부하 환경에서 온도/소음 여유가 작을 수 있습니다.",
      actual: `${metrics.coolerHeadroomW}W 여유`,
      limit: "50W 이상 권장",
      action: "상위 냉각 성능 쿨러 비교"
    });
  }

  const sortedBottlenecks = bottlenecks.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]));
  const nextActions = [...sortedBottlenecks.map((item) => item.action).filter((item): item is string => Boolean(item))];
  if (balance?.status === "cpu_limited") nextActions.push("CPU와 GPU 성능 균형을 보고 CPU 교체 부품을 비교해 보세요.");
  if (balance?.status === "gpu_limited") nextActions.push("CPU와 GPU 성능 균형을 보고 그래픽카드 교체 부품을 비교해 보세요.");
  for (const factor of factors.filter((item) => item.score !== undefined && item.score < 45)) {
    nextActions.push(`${factor.label} 성능을 높일 수 있는 부품을 살펴보세요.`);
  }
  const uniqueActions = [...new Set(nextActions)].slice(0, 4);
  if (uniqueActions.length === 0) uniqueActions.push("현재 구성에서 먼저 바꿀 부품을 찾지 못했어요.");
  return {
    profile,
    overallScore,
    scoreLabel,
    scoreBasis: ANALYSIS_SCORE_BASIS,
    scoreModelVersion: OBJECTIVE_SCORE_MODEL_VERSION,
    confidence,
    factors: factors.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
    ...(balance ? { balance } : {}),
    ...(cpuGpuBalance ? { cpuGpuBalance } : {}),
    strengths,
    focusAreas,
    bottlenecks: sortedBottlenecks.slice(0, 8),
    nextActions: uniqueActions,
    ...(gpuTarget ? { gpuTarget } : {})
  };
}
