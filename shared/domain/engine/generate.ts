import { type PartCategory, type RecommendationPerformanceTier, type BuildSelection, type Part, type RecommendationPriority, type GpuVendor, type RecommendationProfile, type GamingResolution, type GamingRefreshRate, type ListingPolicy, isKnownPrice, type PartSelection, type BuildGenerationDiagnostic, type GeneratedPartTierAdjacency, type BuildGenerationRequest, type GamingPerformanceAssessment, RECOMMENDATION_PROFILE_LABELS, RECOMMENDATION_PRIORITY_LABELS, GAMING_RESOLUTION_VRAM_TARGETS, GAMING_RESOLUTION_LABELS, GAMING_REFRESH_RATE_LABELS, type GeneratedBuildLine, CATEGORY_LABELS, type BuildGenerationResult, type CompatibilityResult, RECOMMENDATION_PERFORMANCE_TIER_LABELS, LISTING_POLICY_LABELS, type BuildGenerationRecoveryOption } from "../../types";
import { DEFAULT_GAMING_RESOLUTION, DEFAULT_GAMING_REFRESH_RATE, generatorObjectiveScores, partReliabilityScoreFor, GENERATOR_CATEGORY_WEIGHTS, cpuModelFamilyFor, gpuModelFamilyFor, BuildGenerationError, cpuMemorySpeedLimitFor, type EngineGenerationOptions, formatPrice, engineNowMilliseconds, gpuTargetEvidenceFor, profileSummaryFor } from "./core";
import { type GamingAdvisoryTuning, gamingGameOptionFor, gamingAdvisoryTuningFor } from "../../gaming-catalog";
import { type EngineTargetFiltersConfig, engineTargetFilterBypassesBrandPolicy, engineTargetFiltersAllowPart, engineTargetFilterNamesPart } from "../../engine-target-filters";
import { isQuoteBrandAllowed, isListingAllowed, isQuotePurchasable, isQuoteSelectable, cpuHasIntegratedGraphics } from "../listing";
import { phase1GpuGamingClass, phase1CpuGamingClass, phase1GamingPartAllowed, phase1GamingFilters } from "../../phase1-gaming-policy";
import { cpuGpuBalanceFor, cpuGamingScoreFor, gamingPreferredSsdCandidates, cpuGamingEvidenceFor, cpuGamingValueFrontier, cpuMeetsGamingGpuFloor, gamingSsdFamilyAllowed, gamingFallbackSsdAllowed } from "../../cpu-gaming-policy";
import { scoreCachedByIdentity } from "../../generator-score-cache";
import { type ReferenceBuild, referenceBuildBudgetWeight, REFERENCE_BUILDS } from "../../reference-builds";
import { phase1IntelStockCpuPowerFor, phase1IntelMotherboardSupportsCpu, phase1MotherboardSupportsCpu, phase1CoolerSupportsCpu, phase1CaseSupportsMotherboard, phase1GpuPowerUpperBoundW, phase1IntelMotherboardEvidenceFor } from "../../phase1-hardware-evidence";
import { resolutionVramRequirementFor, hasPubgGameContext, resolutionGpuReferenceFor, gpuMeetsResolutionReference } from "../../gaming-build-references";
import { type GamingPerformanceEvidenceRecord, gamingPerformanceAssessmentFor } from "../../gaming-performance-evidence";
import { gamingAppropriateMemoryCapacityGb, gamingPartTierAdjacencyFor, gamingTierAssessmentFor } from "../../gaming-part-tiers";
import { gamingCpuModelFor, gamingGpuModelFor } from "../../gaming-target-assessment";
import { evaluateBuild } from "./evaluate";
import { gamingTargetAssessmentForBuild } from "../../gaming-target-build";
import { buildPerformanceReportFor } from "../../relative-performance-index";

const GENERATOR_REQUIRED_FIELDS: Partial<Record<PartCategory, string[]>> = {
  // 크롤러가 채우지 못하는 스펙은 필수로 두지 않는다 — 다나와 목록에
  // maxMemorySpeedMhz(CPU)/vrmCapacityW(보드)가 없어 전체 live 후보가 탈락하고
  // seed 참고 부품만 남아 견적이 허구 가격으로 채워지는 사고를 막는다.
  // CPU maxMemorySpeedMhz는 reparse가 소켓/세대별 네이티브 값으로 채운다.
  cpu: ["socket", "memoryType", "tdpW"],
  // vrmCapacityW는 크롤러 스펙에 없어 live 보드가 전부 탈락했다. 풀 진입은 풀되
  // 미확인 전원부는 evaluateBuild가 저발열 CPU에서는 경고로, 고발열 CPU에서는
  // unknown으로 남겨 순위에서 밀어낸다.
  motherboard: ["socket", "memoryType", "maxMemoryGb", "memorySlots", "m2Slots", "sataPorts", "formFactor"],
  memory: ["memoryType", "capacityGb", "speedMhz", "formFactor"],
  cooler: ["supportedSockets", "maxCoolingW", "maxCoolerHeightMm"],
  gpu: ["powerW", "recommendedPsuW", "lengthMm", "thicknessMm"],
  ssd: ["interface", "formFactor", "capacityGb"],
  hdd: ["interface", "formFactor", "capacityGb"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays", "motherboardFormFactors"],
  psu: ["wattageW", "psuDepthMm", "psuFormFactor"]
};

// Direct performance-tier requests narrow the candidate pools first: GPUs use a
// VRAM floor (the only performance dimension populated across the catalog) and
// CPUs use a relative capability-score floor. When nothing meets the bar the
// original pool is kept so generation still succeeds below the requested tier.
const GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB: Record<RecommendationPerformanceTier, number> = {
  entry: 0,
  high: 12,
  top: 20
};
const GENERATOR_PERFORMANCE_TIER_CPU_MIN_SCORE: Record<RecommendationPerformanceTier, number> = {
  entry: 0,
  high: 35,
  top: 55
};

type GeneratorState = {
  selection: BuildSelection;
  parts: Partial<Record<PartCategory, Part>>;
  priceWon: number;
  capabilityScore: number;
  rankingPriority: RecommendationPriority;
  phase1Gaming?: boolean;
  phase1BudgetWon?: number;
  gamingGameIds?: readonly string[];
};

function generatorHasFields(part: Part, fields: string[]) {
  return fields.every((field) => {
    const value = part.specs[field as keyof typeof part.specs];
    return value !== undefined && (!Array.isArray(value) || value.length > 0);
  });
}

function preferGpuVendor(parts: Part[], preferred: GpuVendor) {
  const matched = parts.filter((part) => part.specs.gpuVendor === preferred);
  return matched.length > 0 ? matched : parts;
}

// 크리에이터/AI 작업은 VRAM이 작업 가능성 자체를 가른다 — 8GB급은 4K 편집/
// 로컬 모델에서 부족하므로 큰 VRAM 후보를 우선하되, 없으면 전체 풀을 유지한다.
function preferMinGpuVram(parts: Part[], minVramGb: number) {
  const matched = parts.filter((part) => (part.specs.vramGb ?? 0) >= minVramGb);
  return matched.length > 0 ? matched : parts;
}

function generatorCapabilityScores(parts: Part[], profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE, gamingAdvisoryTuning?: GamingAdvisoryTuning, gpuVendorPreference?: GpuVendor, nowMilliseconds = Date.now()) {
  const scores = new Map<string, number>();
  const seedIds = new Set(parts.filter((part) => part.dataQuality === "seed").map((part) => part.id));
  for (const [partId, objective] of generatorObjectiveScores(parts, profile, gamingResolution, gamingRefreshRate, gamingAdvisoryTuning, gpuVendorPreference, nowMilliseconds)) {
    // seed 기준 부품은 얇은 커버리지에서만 후보가 되는데, 같은 부품의 live
    // 행과 동점이면 live가 이기게 미세 감점을 둔다(분석 점수에는 영향 없음).
    const seedPenalty = seedIds.has(partId) ? GENERATOR_SEED_SCORE_PENALTY : 0;
    scores.set(partId, (objective.score ?? 50) - seedPenalty);
  }
  return scores;
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
  gamingAdvisoryTuning?: GamingAdvisoryTuning,
  gpuVendorPreference?: GpuVendor,
  nowMilliseconds = Date.now(),
  preShortlistPredicate?: (part: Part) => boolean,
  targetFilters?: EngineTargetFiltersConfig,
  allowIncompleteWithRequiredFields = false,
  preserveAllEligible = false
) {
  // 관리자가 이름 패턴으로 부품을 직접 지명한 범주는 내장 브랜드 정책보다
  // 명시 허용목록이 우선한다(테스트 베드의 KLEVV/PATRIOT RAM 등).
  const bypassBrandPolicy = engineTargetFilterBypassesBrandPolicy(targetFilters, category);
  const catalogCandidates = catalog
    .filter((part) => part.category === category)
    .filter((part) => part.listingType !== "accessory")
    .filter((part) => bypassBrandPolicy || isQuoteBrandAllowed(category, part.brand, part.name))
    // 명시 허용목록(namePatterns) 우회 시에만 세대 정책을 건너뛴다 — seed도
    // 이제 실제 제품을 대표하므로 라이브 부품과 동일한 세대/단종 판정을 받는다.
    .filter((part) => generatorPartQuoteSelectable(part, catalog, bypassBrandPolicy, allowIncompleteWithRequiredFields))
    .filter((part) => engineTargetFiltersAllowPart(part, targetFilters))
    .filter((part) => generatorHasFields(part, requiredFields))
    .filter((part) => isListingAllowed(part, listingPolicy))
    .filter(predicate);
  // Starter rows carry reference prices and may describe products that are no
  // longer sold. They are useful only while a category lacks real inventory —
  // so seeds join the pool only when live/manual coverage is thin (<20).
  // With fuller coverage a stale seed price would beat purchasable parts.
  // 예외: 관리자가 namePatterns로 직접 지명한 seed(테스트 베드 허용목록)는
  // 커버리지와 무관하게 유지한다.
  const sourcedCandidates = catalogCandidates.filter((part) => part.dataQuality !== "seed" || engineTargetFilterNamesPart(part, targetFilters));
  const candidatesBeforeShortlistFilter = sourcedCandidates.length >= GENERATOR_SEED_MIN_LIVE_COVERAGE ? sourcedCandidates : catalogCandidates;
  // Some request constraints must be applied to the full eligible source pool,
  // before capability, price, and reliability slices are built. Otherwise a
  // qualifying part outside those slices disappears before the constraint is
  // checked.
  const candidates = preShortlistPredicate
    ? candidatesBeforeShortlistFilter.filter(preShortlistPredicate)
    : candidatesBeforeShortlistFilter;
  const scores = generatorCapabilityScores(candidates, profile, gamingResolution, gamingRefreshRate, gamingAdvisoryTuning, gpuVendorPreference, nowMilliseconds);
  const selected = new Map<string, Part>();
  const priceLimit = category === "cpu" ? 500 : category === "memory" || category === "gpu" ? 120 : 60;
  [...candidates].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || (a.priceWon ?? 0) - (b.priceWon ?? 0)).slice(0, 40).forEach((part) => selected.set(part.id, part));
  [...candidates].sort((a, b) => (a.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.priceWon ?? Number.MAX_SAFE_INTEGER)).slice(0, priceLimit).forEach((part) => selected.set(part.id, part));
  const reliabilityScoreCache = new Map<Part, number>();
  [...candidates].sort((a, b) => partReliabilityScoreFor(b, reliabilityScoreCache) - partReliabilityScoreFor(a, reliabilityScoreCache) || (a.priceWon ?? Number.MAX_SAFE_INTEGER) - (b.priceWon ?? Number.MAX_SAFE_INTEGER)).slice(0, 20).forEach((part) => selected.set(part.id, part));
  return {
    // Manual steps need every eligible model; recommendation shortlists may
    // remove an intermediate model for value, reliability or price reasons.
    parts: preferNamedParts(preserveAllEligible ? candidates : [...selected.values()]),
    scores,
    candidateCount: candidatesBeforeShortlistFilter.length,
    eligibleCandidateCount: candidates.length
  };
}

function generatorPartQuoteSelectable(part: Part, catalog: Part[], bypassGenerationPolicy: boolean, allowIncompleteWithRequiredFields = false) {
  const selectable = bypassGenerationPolicy ? isQuotePurchasable(part, catalog) : isQuoteSelectable(part, catalog);
  if (selectable) return true;
  // Global coverage includes fields unrelated to this request (e.g. HDD bays
  // in an HDD-free build). The caller separately checks the required fields;
  // catalog quality and missing-field metadata remain unchanged.
  if (!allowIncompleteWithRequiredFields || part.dataQuality !== "incomplete" || part.source === "seed") return false;
  const coverageIndependentPart = { ...part, dataQuality: "live" as const };
  return bypassGenerationPolicy ? isQuotePurchasable(coverageIndependentPart, catalog) : isQuoteSelectable(coverageIndependentPart, catalog);
}

// seed 부품이 후보 풀에 들어가는 조건 — 라이브(다나와 실측)+수동 등록 부품이
// 이 수 미만이면 커버리지가 얇아 seed 참고 부품을 함께 쓴다.
const GENERATOR_SEED_MIN_LIVE_COVERAGE = 20;
// 얇은 커버리지에서 seed와 live가 동일 부품/동일 스펙으로 겹칠 때 live가
// 이기도록 미세한 감점을 둔다 — seed 가격은 시점이 오래될 수 있어서다.
const GENERATOR_SEED_SCORE_PENALTY = 3;

// "PC Supporter" 브랜드는 스펙 기준 플레이스홀더다 — 실제 판매 상품이 아니라
// 조합용 참고 부품이라 견적에 노출되면 구매할 수 없다. 실구매 제품이 있으면
// 그쪽으로 모으고, 없을 때만 기준 부품으로 떨어진다.
function preferNamedParts(parts: Part[]) {
  const named = parts.filter((part) => part.brand !== "PC Supporter");
  return named.length > 0 ? named : parts;
}

function generatorStoragePool(catalog: Part[], category: "ssd" | "hdd", profile: RecommendationProfile, requestedCapacityGb: number, listingPolicy: ListingPolicy, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE, nowMilliseconds = Date.now(), targetFilters?: EngineTargetFiltersConfig) {
  const preferred = generatorCandidatePool(catalog, category, profile, (part) => {
    const capacity = part.specs.capacityGb;
    // 확장 단계의 preferRequestedCapacity와 같은 2배 폭으로 둔다 — 더 좁은
    // 상한은 "요청보다 크지만 더 싼" 부품(예: 500GB 요청에 더 저렴한 1TB)을
    // 풀에서 빼버려 오히려 총액이 올라가는 경우를 만든다.
    return capacity !== undefined && capacity >= requestedCapacityGb && capacity <= requestedCapacityGb * (category === "ssd" ? 2.048 : 2);
  }, listingPolicy, gamingResolution, gamingRefreshRate, undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters);
  return preferred.parts.length > 0 ? preferred : generatorCandidatePool(catalog, category, profile, () => true, listingPolicy, gamingResolution, gamingRefreshRate, undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters);
}

function generatorMemoryPool(catalog: Part[], profile: RecommendationProfile, requestedCapacityGb: number, listingPolicy: ListingPolicy, gamingResolution: GamingResolution, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE, nowMilliseconds = Date.now(), targetFilters?: EngineTargetFiltersConfig) {
  // 요청 용량과 거의 같은 총용량(실제 구매 수량 기준)을 우선한다 — 32GB 요청에
  // 64GB가 나오는 과잉 구성을 막고, 없을 때만 넓은 범위로 fallback한다.
  const fitsRequest = (part: Part, overshootRatio: number) => {
    const capacityGb = part.specs.capacityGb;
    if (capacityGb === undefined) return false;
    const totalGb = capacityGb * memoryKitQuantityFor(part, requestedCapacityGb);
    return totalGb >= requestedCapacityGb && totalGb <= requestedCapacityGb * overshootRatio;
  };
  const tight = generatorCandidatePool(catalog, "memory", profile, (part) => fitsRequest(part, 1.25), listingPolicy, gamingResolution, gamingRefreshRate, undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters);
  if (tight.parts.length > 0) return tight;
  return generatorCandidatePool(catalog, "memory", profile, (part) => fitsRequest(part, 2), listingPolicy, gamingResolution, gamingRefreshRate, undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters);
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

const GENERATOR_WARNING_SCORE_PENALTY = 40;
// 장착 미확인(라디에이터 지원/쿨러 높이 등)은 "데이터가 없어 검증 불가"라는
// 의미다. 점수에서 무조건 탈락시키면 크롤링 스펙이 얇은 부품 조합(예: 수랭
// 쿨러 + 라디에이터 정보 미기재 케이스)이 구조적으로 선택될 수 없고, 반대로
// 완전 무시하면 확인이 필요한 조합이 깨끗한 대안을 밀어낸다. 경고보다 무겁게
// 보는 점수 감점으로 다루고, 최종 상태는 needs_review로 유지한다.
const GENERATOR_FIT_UNKNOWN_SCORE_PENALTY = 120;
// 장착/전원이 아닌 팬/RGB 헤더 수/전압 같은 장식성 확인 항목은
// 생성기 순위의 hard gate에서 제외한다. 누락 스펙이 실제 호환 위험이면 계속 gate가 된다.
// 장착/동작에 실질 리스크가 없는 "확인용" 데이터 공백이다 — 케이스 팬/RGB 헤더
// (장식성), 메모리 프로파일 지원표(사실상 모든 DDR5 보드가 EXPO/XMP를 지원하고
// 미지원 시 기본 속도로 동작할 뿐), M.2/PCIe 레인 공유 표기(장착은 되고 대역폭만
// 최대 x8로 내려갈 수 있는 사양 — 카탈로그의 절반 가까운 보드가 표기 없음)는
// 상태를 needs_review로 내리지 않는다.
const GENERATOR_COSMETIC_UNKNOWN_RULES = new Set(["case-fan-headers", "case-rgb-headers", "case-rgb-voltage", "memory-profile", "m2-pcie-lane-sharing"]);

function generatorStateScore(state: GeneratorState, budgetWon: number) {
  const overBudgetRatio = Math.max(0, state.priceWon - budgetWon) / Math.max(budgetWon, 1);
  return state.capabilityScore - overBudgetRatio * 2000 - (state.priceWon / Math.max(budgetWon, 1)) * 8;
}

function generatorStateReliabilityScoreFor(state: GeneratorState, partScoreCache?: Map<Part, number>) {
  return Object.values(state.parts)
    .filter((part): part is Part => Boolean(part))
    .reduce((total, part) => total + partReliabilityScoreFor(part, partScoreCache), 0);
}

function generatorStatePriorityScore(state: GeneratorState, budgetWon: number, priority: RecommendationPriority) {
  if (state.phase1Gaming) return phase1GeneratorStateScore(state, budgetWon);
  const overBudgetRatio = Math.max(0, state.priceWon - budgetWon) / Math.max(budgetWon, 1);
  if (priority === "performance") return state.capabilityScore - overBudgetRatio * 2000;
  if (priority === "reliability") return generatorStateReliabilityScoreFor(state) - overBudgetRatio * 2000;
  if (priority === "budget") return -state.priceWon;
  return generatorStateScore(state, budgetWon);
}

function phase1GeneratorStateScore(state: GeneratorState, budgetWon: number) {
  // GPU improvement always precedes CPU and support-component spending. Extra
  // cores, decorative case features and excess wattage cannot accumulate enough
  // points to displace an affordable stronger GPU.
  const gpuClass = phase1GpuGamingClass(state.parts.gpu);
  const cpuClass = phase1CpuGamingClass(state.parts.cpu);
  const rankingBudget = state.phase1BudgetWon ?? budgetWon;
  // A requested pin may make the budget impossible. In that case show the
  // cheapest compatible adjustment, instead of using the relaxed completion
  // bound as permission to also buy a much more expensive unrequested GPU.
  if (state.priceWon > rankingBudget) return -state.priceWon / 1_000;
  const balance = cpuGpuBalanceFor(state.parts.cpu, state.parts.gpu, state.parts.motherboard?.specs.memoryType, state.gamingGameIds);
  // Once the GPU has a suitable CPU, extra CPU cores/cache cannot outrank a cheaper balanced platform.
  const cpuValue = state.parts.gpu ? balance?.cpu.level === "good" ? 100 : balance?.cpu.level === "slightly_strong" ? 95 : balance?.cpu.level === "too_strong" ? 90 : balance?.cpu.level === "slightly_weak" ? (cpuGamingScoreFor(state.parts.cpu) ?? 0) * 0.8 : 0 : cpuClass * 10;
  return gpuClass * 1_000_000 + cpuValue * 1_000 - state.priceWon / 100;
}

function cheapestGeneratorCandidates(parts: Part[], quantityOf: (part: Part) => number = () => 1) {
  const cheapest = Math.min(...parts.map((part) => isKnownPrice(part.priceWon) ? part.priceWon * quantityOf(part) : Number.POSITIVE_INFINITY));
  return parts.filter((part) => isKnownPrice(part.priceWon) && part.priceWon * quantityOf(part) === cheapest);
}

type RemainingGeneratorCostForState = (state: GeneratorState) => number;

function pruneGeneratorStates(
  states: GeneratorState[],
  budgetWon: number,
  limit = 160,
  remainingCostForState: RemainingGeneratorCostForState = () => 0
) {
  const priority = states[0]?.rankingPriority ?? "balanced";
  const partReliabilityScores = new Map<Part, number>();
  const stateReliabilityScores = new Map<GeneratorState, number>();
  const stateRemainingCosts = new Map<GeneratorState, number>();
  const remainingCostFor = (state: GeneratorState) => scoreCachedByIdentity(
    stateRemainingCosts,
    state,
    () => remainingCostForState(state)
  );
  const reliabilityScoreForState = (state: GeneratorState) => scoreCachedByIdentity(
    stateReliabilityScores,
    state,
    () => generatorStateReliabilityScoreFor(state, partReliabilityScores)
  );
  const priorityScore = (state: GeneratorState) => {
    if (state.phase1Gaming) return phase1GeneratorStateScore(state, budgetWon);
    if (priority !== "reliability") return generatorStatePriorityScore(state, budgetWon, priority);
    const overBudgetRatio = Math.max(0, state.priceWon - budgetWon) / Math.max(budgetWon, 1);
    return reliabilityScoreForState(state) - overBudgetRatio * 2000;
  };
  const unique = new Map<string, GeneratorState>();
  for (const state of states) {
    const key = ["cpu", "gpu", "motherboard", "memory", "cooler", "case", "ssd", "hdd", "psu"]
      .map((category) => `${category}:${state.parts[category as PartCategory]?.id ?? ""}:${state.selection[category as PartCategory] && !Array.isArray(state.selection[category as PartCategory]) ? (state.selection[category as PartCategory] as PartSelection).quantity : ""}`)
      .join("|");
    const existing = unique.get(key);
    if (!existing || priorityScore(state) > priorityScore(existing)) unique.set(key, state);
  }
  // Keep states that can still finish within budget ahead of partial states
  // whose remaining required parts already make the budget impossible. The
  // bound is optimistic; final compatibility and scoring still run unchanged.
  const sorted = [...unique.values()].sort((a, b) => {
    const aPotentiallyWithinBudget = a.priceWon + Math.max(0, remainingCostFor(a)) <= budgetWon;
    const bPotentiallyWithinBudget = b.priceWon + Math.max(0, remainingCostFor(b)) <= budgetWon;
    return Number(bPotentiallyWithinBudget) - Number(aPotentiallyWithinBudget)
      || priorityScore(b) - priorityScore(a)
      || a.priceWon - b.priceWon;
  });
  const cheap = [...unique.values()].sort((a, b) => a.priceWon - b.priceWon).slice(0, Math.max(1, Math.floor(limit / 4)));
  const reliable = [...unique.values()].sort((a, b) => reliabilityScoreForState(b) - reliabilityScoreForState(a) || a.priceWon - b.priceWon).slice(0, Math.max(1, Math.floor(limit / 4)));
  const kept = new Map<string, GeneratorState>();
  for (const state of [...cheap, ...sorted, ...reliable]) {
    const key = ["cpu", "gpu", "motherboard", "memory", "cooler", "case", "ssd", "hdd", "psu"]
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
    capabilityScore: state.capabilityScore + capabilityScore * (GENERATOR_CATEGORY_WEIGHTS[profile][category] ?? 1),
    rankingPriority: state.rankingPriority,
    ...(state.phase1Gaming ? { phase1Gaming: true, phase1BudgetWon: state.phase1BudgetWon } : {})
  };
}

const GENERATOR_DEBUG = typeof process !== "undefined" && process.env.PC_SUPPORTER_GENERATOR_DEBUG === "1";

function generatorDebugLog(step: string, states: GeneratorState[], budgetWon: number) {
  if (!GENERATOR_DEBUG) return;
  const priority = states[0]?.rankingPriority ?? "balanced";
  const ranked = [...states].sort((a, b) => generatorStatePriorityScore(b, budgetWon, priority) - generatorStatePriorityScore(a, budgetWon, priority)).slice(0, 12);
  console.error(`[generator] ${step}: ${states.length} states`);
  for (const state of ranked) {
    const parts = Object.entries(state.parts).map(([category, part]) => `${category}=${part?.id}`).join(" ");
    console.error(`  price=${state.priceWon} capability=${Math.round(state.capabilityScore)} ${parts}`);
  }
  const gpuIds = new Map<string, number>();
  for (const state of states) {
    const id = state.parts.gpu?.id ?? "none";
    gpuIds.set(id, (gpuIds.get(id) ?? 0) + 1);
  }
  console.error(`  distinct gpus: ${[...gpuIds.keys()].slice(0, 20).join(", ")}${gpuIds.size > 20 ? ` (+${gpuIds.size - 20} more)` : ""}`);
  const cpuIds = new Map<string, number>();
  for (const state of states) {
    const id = state.parts.cpu?.id ?? "none";
    cpuIds.set(id, (cpuIds.get(id) ?? 0) + 1);
  }
  console.error(`  distinct cpus: ${[...cpuIds.entries()].slice(0, 20).map(([id, n]) => `${id}x${n}`).join(", ")}${cpuIds.size > 20 ? ` (+${cpuIds.size - 20} more)` : ""}`);
}

const REFERENCE_BUILD_CPU_MATCH_BONUS = 12;
const REFERENCE_BUILD_GPU_PAIR_BONUS = 18;
const REFERENCE_BUILD_GPU_FAMILY_BONUS = 6;
const REFERENCE_BUILD_PROFILE_MISMATCH_WEIGHT = 0.5;

// 참조 견적의 원문 부품명을 카탈로그 부품과 같은 모델 계열 키로 정규화한다.
// 계열 함수들이 part의 category/model/name만 읽으므로 이름만 담은 최소 객체로 충분하다.
type ReferenceBuildFamilies = { cpuFamily?: string; gpuFamily?: string };
const referenceBuildFamilyCache = new WeakMap<ReferenceBuild, ReferenceBuildFamilies>();

function referenceBuildFamiliesFor(build: ReferenceBuild): ReferenceBuildFamilies {
  const cached = referenceBuildFamilyCache.get(build);
  if (cached) return cached;
  const families: ReferenceBuildFamilies = {
    cpuFamily: build.parts.cpu ? cpuModelFamilyFor({ category: "cpu", name: build.parts.cpu }) : undefined,
    gpuFamily: build.parts.gpu ? gpuModelFamilyFor({ category: "gpu", name: build.parts.gpu }) : undefined
  };
  referenceBuildFamilyCache.set(build, families);
  return families;
}

function referenceBuildProfileWeight(build: ReferenceBuild, profile: RecommendationProfile) {
  return build.profile === profile ? 1 : REFERENCE_BUILD_PROFILE_MISMATCH_WEIGHT;
}

// CPU 단계: 요청 예산 근처의 참조 견적에 등장하는 CPU 계열이면 점수 보너스를 준다.
function referenceCpuScoreAdjustmentFor(part: Part, profile: RecommendationProfile, budgetWon: number, builds: readonly ReferenceBuild[]) {
  if (part.category !== "cpu") return 0;
  const family = cpuModelFamilyFor(part);
  if (!family) return 0;
  let bonus = 0;
  for (const build of builds) {
    if (referenceBuildFamiliesFor(build).cpuFamily !== family) continue;
    bonus = Math.max(bonus, REFERENCE_BUILD_CPU_MATCH_BONUS * referenceBuildBudgetWeight(budgetWon, build.budgetWon) * referenceBuildProfileWeight(build, profile));
  }
  return bonus;
}

// GPU 단계: 이미 고른 CPU 계열과 같은 참조 견적에 짝지어진 GPU 계열이면 강한
// 보너스, 다른 CPU와 짝지어졌더라도 예산대에 등장하는 GPU 계열이면 약한 보너스.
function referenceGpuScoreAdjustmentFor(cpu: Part | undefined, part: Part, profile: RecommendationProfile, budgetWon: number, builds: readonly ReferenceBuild[]) {
  if (part.category !== "gpu") return 0;
  const gpuFamily = gpuModelFamilyFor(part);
  if (!gpuFamily) return 0;
  const cpuFamily = cpu ? cpuModelFamilyFor(cpu) : undefined;
  let bonus = 0;
  for (const build of builds) {
    const families = referenceBuildFamiliesFor(build);
    if (families.gpuFamily !== gpuFamily) continue;
    const weight = referenceBuildBudgetWeight(budgetWon, build.budgetWon) * referenceBuildProfileWeight(build, profile);
    if (weight <= 0) continue;
    const base = cpuFamily !== undefined && families.cpuFamily === cpuFamily
      ? REFERENCE_BUILD_GPU_PAIR_BONUS
      : REFERENCE_BUILD_GPU_FAMILY_BONUS;
    bonus = Math.max(bonus, base * weight);
  }
  return bonus;
}

function expandGeneratorStates(
  states: GeneratorState[],
  category: PartCategory,
  candidatesForState: (state: GeneratorState) => Part[],
  scores: Map<string, number>,
  profile: RecommendationProfile,
  budgetWon: number,
  quantity?: number | ((part: Part) => number),
  pruneLimit = 160,
  remainingCostForState: RemainingGeneratorCostForState = () => 0,
  scoreAdjustmentForState?: (state: GeneratorState, part: Part) => number
) {
  const expanded: GeneratorState[] = [];
  let producedBeforeBudgetCut = 0;
  // 예산에 못 맞춰 컷된 완성 추정치 중 가장 낮은 값 — 진단 메시지가 "현재
  // 부품을 넣기 전" 합계를 보고하면 예산보다 낮은 값이 나와 혼란을 준다.
  let minRejectedCompletion = Number.POSITIVE_INFINITY;
  for (const state of states) {
    for (const part of candidatesForState(state)) {
      const score = (scores.get(part.id) ?? 50) + (scoreAdjustmentForState?.(state, part) ?? 0);
      const next = addGeneratorPart(state, category, part, score, profile, typeof quantity === "function" ? quantity(part) : quantity);
      // 이미 초과 확정인 상태는 자리만 차지한다 — 이후 단계는 비용을 더하기만
      // 하므로 `현재 합계 + 남은 최소 비용 > 예산`이면 여기서 끊는다. 상한이
      // 아니라 하한으로 자르는 것이라 고사양 조합은 여전히 예산 내에서 산다.
      producedBeforeBudgetCut += 1;
      const completionEstimate = next.priceWon + Math.max(0, remainingCostForState(next));
      if (completionEstimate <= budgetWon) {
        expanded.push(next);
      } else if (completionEstimate < minRejectedCompletion) {
        minRejectedCompletion = completionEstimate;
      }
    }
  }
  // 하한 컷으로 전멸했으면 진짜 원인은 예산이다 — 단계별 "부품을 찾지 못했
  // 습니다"가 아니라 budget-infeasible로 보고해야 내장그래픽 폴백/예산 조정
  // 안내가 발동한다. 후보 자체가 없던 전멸(호환성)은 기존 단계별 오류가 담당한다.
  if (expanded.length === 0 && producedBeforeBudgetCut > 0) {
    const minCompletion = Number.isFinite(minRejectedCompletion)
      ? minRejectedCompletion
      : Math.min(...states.map((state) => state.priceWon + Math.max(0, remainingCostForState(state))));
    const budgetLabel = Number.isFinite(minCompletion) ? `${Math.round(minCompletion).toLocaleString("ko-KR")}원` : null;
    throw new BuildGenerationError(
      `요청 예산 ${budgetWon.toLocaleString("ko-KR")}원으로는 남은 필수 부품까지 갖춘 구성을 만들 수 없습니다.${budgetLabel ? ` 가장 낮은 후보 합계는 ${budgetLabel}입니다.` : ""}`,
      [{
        id: "budget-infeasible",
        title: "요청 예산 안에 자동 구성이 없습니다.",
        summary: "남은 필수 부품의 최저가까지 반영해도 예산을 넘는 조합뿐입니다.",
        facts: [
          { label: "요청 예산", value: `${budgetWon.toLocaleString("ko-KR")}원` },
          ...(budgetLabel ? [{ label: "가장 저렴한 조합", value: budgetLabel }] : [])
        ]
      }]
    );
  }
  // 부품별 최저가 상태를 1개씩 보존한다 — 상위 슬롯이 고사양 조합으로 가득 차면
  // (예: 9800X3D+RTX 5080) 저예산 조합(저가 CPU+같은 GPU)이 잘려 뒤 단계에서
  // 해당 부품 자체가 사라진다. 부품당 가장 싼 조합은 완주 여유가 가장 크다.
  const cheapestPerPart = new Map<string, GeneratorState>();
  for (const state of expanded) {
    const partId = state.parts[category]?.id;
    if (partId === undefined) continue;
    const existing = cheapestPerPart.get(partId);
    if (!existing || state.priceWon < existing.priceWon) cheapestPerPart.set(partId, state);
  }
  const pruned = pruneGeneratorStates(expanded, budgetWon, Math.max(1, pruneLimit - cheapestPerPart.size), remainingCostForState);
  const merged = new Map<string, GeneratorState>();
  const stateKey = (state: GeneratorState) => (["cpu", "gpu", "motherboard", "memory", "cooler", "case", "ssd", "hdd", "psu"] as PartCategory[])
    .map((key) => `${key}:${state.parts[key]?.id ?? ""}`)
    .join("|");
  const spread = [...cheapestPerPart.values()]
    .sort((a, b) => a.priceWon - b.priceWon)
    .slice(0, pruneLimit);
  for (const state of [...spread, ...pruned]) {
    const key = stateKey(state);
    if (!merged.has(key)) merged.set(key, state);
  }
  const keptStates = [...merged.values()];
  generatorDebugLog(category, keptStates, budgetWon);
  return keptStates;
}

function requireGeneratorStates(states: GeneratorState[], message: string, diagnostics: BuildGenerationDiagnostic[] = []) {
  if (states.length === 0) throw diagnostics.length > 0 ? new BuildGenerationError(message, diagnostics) : new Error(message);
  return states;
}

function minimumPositiveGeneratorCost(parts: Part[], quantityForPart: (part: Part) => number = () => 1) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    if (!isKnownPrice(part.priceWon)) continue;
    const cost = part.priceWon * quantityForPart(part);
    if (Number.isFinite(cost) && cost > 0) minimum = Math.min(minimum, cost);
  }
  // A missing candidate price must never make the optimistic bound exclude a
  // state. Candidate-pool validation and final selection keep their own gates.
  return Number.isFinite(minimum) ? minimum : 0;
}

function generatorCpuSupportsMemoryPreference(cpu: Part, preference: "DDR4" | "DDR5" | undefined): boolean {
  if (preference === undefined) return true;
  if (cpu.specs.socket === "AM4") return preference === "DDR4";
  if (cpu.specs.socket === "AM5" || cpu.specs.socket === "LGA1851") return preference === "DDR5";
  if (cpu.specs.socket === "LGA1700") return true;
  return cpu.specs.memoryType === preference;
}

function generatorCpuCanUseMotherboard(cpu: Part, motherboard: Part, phase1Gaming = false) {
  const cpuPower = cpu.specs.pptW ?? phase1IntelStockCpuPowerFor(cpu)?.turboW ?? cpu.specs.tdpW;
  return cpu.specs.socket !== undefined
    && motherboard.specs.socket === cpu.specs.socket
    && (motherboard.specs.memoryType === cpu.specs.memoryType || cpu.specs.socket === "LGA1700" && ["DDR4", "DDR5"].includes(motherboard.specs.memoryType ?? ""))
    && cpuPower !== undefined
    && (!phase1Gaming || (cpu.specs.socket.startsWith("LGA") ? motherboard.specs.vrmCapacityW !== undefined || phase1IntelMotherboardSupportsCpu(cpu, motherboard) : phase1MotherboardSupportsCpu(cpu, motherboard)))
    && (motherboard.specs.vrmCapacityW === undefined || motherboard.specs.vrmCapacityW >= cpuPower);
}

function generatorMemoryCanUseMotherboard(memory: Part, motherboard: Part, cpu: Part | undefined, requestedCapacityGb: number, namedPart = false) {
  const profileKnown = (memory.specs.memoryProfiles?.length ?? 0) > 0;
  const confirmedSpeedLimits = [
    motherboard.specs.maxMemorySpeedMhz,
    ...(profileKnown ? [cpuMemorySpeedLimitFor(cpu, memory.specs.memoryType ?? motherboard.specs.memoryType)] : [])
  ].filter((value): value is number => value !== undefined && value > 0);
  const effectiveSpeedLimit = confirmedSpeedLimits.length > 0 ? Math.min(...confirmedSpeedLimits) : undefined;
  const profileOverlap = !profileKnown
    || motherboard.specs.memoryProfiles === undefined
    || memory.specs.memoryProfiles!.some((profile) => motherboard.specs.memoryProfiles!.includes(profile));
  const kitQuantity = memoryKitQuantityFor(memory, requestedCapacityGb);
  const physicalModuleCount = (memory.specs.memoryModuleCountPerKit ?? 1) * kitQuantity;
  // SO-DIMM은 명시적으로 SO-DIMM 슬롯을 선언한 보드에만 장착된다.
  // 규격 미기재 데스크톱 보드와의 조합은 실측 불가가 아니라 물리 부적합으로 본다.
  const boardMemoryFormFactor = motherboard.specs.memoryFormFactor;
  const moduleFormFactor = memory.specs.formFactor;
  const formFactorCompatible = moduleFormFactor === "SO-DIMM"
    ? boardMemoryFormFactor === "SO-DIMM"
    : boardMemoryFormFactor === undefined || boardMemoryFormFactor === moduleFormFactor;
  // 보드/CPU 양쪽의 메모리 상한이 모두 없으면 속도 검증을 건너뛴다 — 크롤링
  // 스펙에 상한이 없는 보드가 대부분이라, 강제하면 모든 live 보드×RAM 조합이
  // 실패하고 seed 보드만 남는다. 상한이 있는 쪽은 그대로 적용해 초고속 킷의
  // 낭비를 막고, 미확인은 부팅 불가가 아니라 JEDEC 기본 속도로 동작할 뿐이다.
  // 관리자 지명 부품(namedPart)은 초고속 EXPO/XMP 킷처럼 네이티브 상한을 넘어도
  // 실제 플랫폼에서 동작하는 경우가 있어 속도 게이트를 면제한다.
  const speedCompatible = namedPart
    ? memory.specs.speedMhz !== undefined
    : effectiveSpeedLimit === undefined
      ? memory.specs.speedMhz !== undefined
      : memory.specs.speedMhz !== undefined && memory.specs.speedMhz <= effectiveSpeedLimit;
  return formFactorCompatible
    && profileOverlap
    && memory.specs.memoryType === motherboard.specs.memoryType
    && memory.specs.capacityGb !== undefined
    && motherboard.specs.maxMemoryGb !== undefined
    && memory.specs.capacityGb * kitQuantity <= motherboard.specs.maxMemoryGb
    && speedCompatible
    && motherboard.specs.memorySlots !== undefined
    && motherboard.specs.memorySlots >= physicalModuleCount;
}

function generatorCoolerCanUseCpu(cooler: Part, cpu: Part, phase1Gaming = false) {
  if (phase1Gaming) return phase1CoolerSupportsCpu(cooler, cpu);
  const cpuHeat = cpu.specs.pptW ?? cpu.specs.tdpW;
  return cpu.specs.socket !== undefined
    && cooler.specs.supportedSockets?.includes(cpu.specs.socket) === true
    && cpuHeat !== undefined
    && cooler.specs.maxCoolingW !== undefined
    && cooler.specs.maxCoolingW >= cpuHeat;
}

function generatorCaseCanUseParts(computerCase: Part, motherboard: Part, cooler: Part | undefined, gpu: Part | undefined, hddCount: number, phase1Gaming = false) {
  const liquidSupport = !cooler || cooler.specs.coolerType !== "liquid" || !phase1Gaming || (
    cooler.specs.radiatorSizeMm !== undefined && (
      (computerCase.specs.radiatorSupports ?? []).some((support) => (!cooler.specs.radiatorPosition || support.position === cooler.specs.radiatorPosition) && support.sizesMm.includes(cooler.specs.radiatorSizeMm!))
      || (computerCase.specs.radiatorSupports?.length ?? 0) === 0 && computerCase.specs.radiatorSizesMm?.includes(cooler.specs.radiatorSizeMm) === true
    )
  );
  const coolerFits = !cooler || phase1Gaming && cooler.specs.coolerType === "liquid" ? liquidSupport : (cooler.specs.maxCoolerHeightMm !== undefined && computerCase.specs.maxCoolerHeightMm !== undefined && cooler.specs.maxCoolerHeightMm <= computerCase.specs.maxCoolerHeightMm);
  return motherboard.specs.formFactor !== undefined
    && computerCase.specs.motherboardFormFactors?.includes(motherboard.specs.formFactor) === true
    && (!phase1Gaming || phase1CaseSupportsMotherboard(computerCase, motherboard))
    && coolerFits
    && (hddCount === 0 || (computerCase.specs.hddBays !== undefined && computerCase.specs.hddBays >= hddCount))
    && (!gpu || (gpu.specs.lengthMm !== undefined && computerCase.specs.maxGpuLengthMm !== undefined && gpu.specs.lengthMm <= computerCase.specs.maxGpuLengthMm))
    // LP 전용 케이스는 LP 브라켓이 확인된 그래픽카드만 받는다.
    && (!gpu || computerCase.specs.lowProfileOnly !== true || gpu.specs.lowProfileBracket === true);
}

function generatorStorageCanUseMotherboard(storage: Part, motherboard: Part, existingSsd: Part | undefined, hddCount: number, allowPcieSpeedDowngrade = false) {
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
    || storage.specs.m2PcieGeneration <= motherboardMaxM2PcieGeneration
    // Gaming storage is chosen by capacity value. A newer NVMe link can run
    // at the board's lower PCIe speed; evaluateBuild keeps that speed warning.
    || allowPcieSpeedDowngrade;
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

// 정격 용량이 클수록 무조건 높은 지수를 받는 구조에서는 iGPU 사무용에도
// 1300W 파워가 선택된다. 시스템 예상 부하 + 헤드룸 상한 안쪽만 우선한다.
function estimateSystemPowerW(state: GeneratorState) {
  const cpuW = state.parts.cpu?.specs.pptW ?? phase1IntelStockCpuPowerFor(state.parts.cpu)?.turboW ?? state.parts.cpu?.specs.tdpW ?? 125;
  const gpuW = state.parts.gpu ? (state.phase1Gaming ? phase1GpuPowerUpperBoundW(state.parts.gpu) : state.parts.gpu.specs.powerW) ?? 0 : 0;
  return cpuW + gpuW + 150;
}

// 상한은 필요량×1.25 또는 GPU 권장+50W까지로 둔다 — transient 스파이크
// 여유를 넘는 과잉 용량(400W급 구성에 800W)은 가격만 올리고 실효 이익이 없다.
// 같은 "충분한 용량" 대역 안에서는 최저가 부근만 남긴다 — 효율이 비슷한데
// 와트수가 큰 파워가 capability 점수로 이기는 걸 막는다.
function preferAdequatePsu(parts: Part[], state: GeneratorState) {
  const needW = estimateSystemPowerW(state);
  const gpuMinW = state.parts.gpu?.specs.recommendedPsuW ?? 0;
  const ceilingW = Math.max(needW * 1.25, gpuMinW + 50, 500);
  const adequate = parts.filter((part) => {
    const wattage = part.specs.wattageW;
    return wattage !== undefined && wattage <= ceilingW;
  });
  const pool = adequate.length > 0 ? adequate : parts;
  const cheapest = Math.min(...pool.map((part) => isKnownPrice(part.priceWon) ? part.priceWon! : Number.MAX_SAFE_INTEGER));
  if (!Number.isFinite(cheapest)) return pool;
  const value = pool.filter((part) => !isKnownPrice(part.priceWon) || part.priceWon <= cheapest * 1.4);
  return value.length > 0 ? value : pool;
}

// 장착 요건(폼팩터/GPU 길이/쿨러 높이)을 통과한 케이스는 크기/베이 같은
// capability 지수가 큰 쪽이 이기기 쉬워 예산이 남으면 케이스부터 비싸진다.
// 호환 후보 안에서는 최저가 대역을 우선해 여유 예산이 GPU/CPU로 먼저 간다.
function preferValueCase(parts: Part[]) {
  const cheapest = Math.min(...parts.map((part) => isKnownPrice(part.priceWon) ? part.priceWon! : Number.MAX_SAFE_INTEGER));
  if (!Number.isFinite(cheapest)) return parts;
  const value = parts.filter((part) => !isKnownPrice(part.priceWon) || part.priceWon <= cheapest * 1.8);
  return value.length > 0 ? value : parts;
}

// 요청 용량을 채운 SSD 사이에서 순차읽기/PCIe 세대 같은 capability 지수가
// 큰 쪽(990 PRO/9100 PRO급 플래그십)이 저예산 게임 빌드에서도 이긴다.
// 용량 조건을 만족한 후보 안에서는 최저가 대역을 우선한다.
function preferValueStorage(parts: Part[]) {
  const cheapest = Math.min(...parts.map((part) => isKnownPrice(part.priceWon) ? part.priceWon! : Number.MAX_SAFE_INTEGER));
  if (!Number.isFinite(cheapest)) return parts;
  const value = parts.filter((part) => !isKnownPrice(part.priceWon) || part.priceWon <= cheapest * 1.3);
  return value.length > 0 ? value : parts;
}

// ± 밸런스 조정 티어 — 같은 모델(칩+VRAM, 광고 접미어 차이)의 부품을 하나의
// 등급으로 묶고, 등급을 성능 점수 순으로 나열한다. 색상/유통사 같은 무의미한
// 차이는 키에서 제외한다.
const GENERATOR_TIER_VENDOR_TOKENS = /\b(블랙|화이트|실버|골드|그레이|블루|레드|핑크|rgb|argb|서린|제이씨현|대원씨티에스|이엠텍|인텍앤컴퍼니|피씨디렉트|한성컴퓨터|코잇|에즈윈|디앤디컴|도우정보|아이코다|가이드컴|웨이코스|볼텍스|오지웍스|멀티팩|정품|벌크|트레이|단품|패키지|stcom|edel|compuzone|ocs)\b/gi;

function generatorPartModelKey(part: Part): string {
  const name = part.name.toLowerCase();
  if (part.category === "gpu") {
    const chip = name.match(/(rtx|gtx|rx|arc)\s*\d+\s*(?:ti|xt|super|xtx)?/i);
    if (chip) return `${chip[0].replace(/\s+/g, "")}|${part.specs.vramGb ?? "?"}`;
  }
  return name
    .replace(/\(.*?\)/g, " ")
    .replace(GENERATOR_TIER_VENDOR_TOKENS, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

// 현재 부품이 속한 등급의 바로 위/아래 등급 대표 부품을 찾는다. 대표는 같은
// 등급 안에서 가장 저렴한 부품 — 업그레이드 비용을 최소로 올리는 방향이
// 예산 균형 도구의 의도와 맞는다.
function generatorPartTierAdjacency(parts: Part[], scores: Map<string, number>, currentId: string, modelKeyFor = generatorPartModelKey, enforcePriceDirection = true): GeneratedPartTierAdjacency {
  const groups = new Map<string, { score: number; rep: Part }>();
  for (const part of parts) {
    const key = modelKeyFor(part);
    const score = scores.get(part.id) ?? 50;
    const existing = groups.get(key);
    const price = isKnownPrice(part.priceWon) ? part.priceWon! : Number.MAX_SAFE_INTEGER;
    if (existing === undefined) {
      groups.set(key, { score, rep: part });
      continue;
    }
    const repPrice = isKnownPrice(existing.rep.priceWon) ? existing.rep.priceWon! : Number.MAX_SAFE_INTEGER;
    groups.set(key, { score: Math.max(existing.score, score), rep: price < repPrice ? part : existing.rep });
  }
  const current = parts.find((part) => part.id === currentId);
  if (current === undefined) return {};
  const currentKey = modelKeyFor(current);
  const ordered = [...groups.entries()].sort((a, b) => (b[1].score - a[1].score) || ((a[1].rep.priceWon ?? 0) - (b[1].rep.priceWon ?? 0)));
  const index = ordered.findIndex(([key]) => key === currentKey);
  if (index < 0) return {};
  // 점수 순으로 한 단계씩 올리/내리되, 가격 방향이 반대인 등급은 건너뛴다 —
  // "−"는 더 싸고 "＋"는 더 비싼 선택지라는 사용자 기대와 맞춘다.
  const currentPrice = isKnownPrice(current.priceWon) ? current.priceWon! : undefined;
  const up = ordered.slice(0, index).reverse().find(([, entry]) => !enforcePriceDirection || currentPrice === undefined || (isKnownPrice(entry.rep.priceWon) && entry.rep.priceWon! > currentPrice))?.[1].rep;
  const down = ordered.slice(index + 1).find(([, entry]) => !enforcePriceDirection || currentPrice === undefined || (isKnownPrice(entry.rep.priceWon) && entry.rep.priceWon! < currentPrice))?.[1].rep;
  return {
    ...(up !== undefined && up.id !== currentId ? { upId: up.id } : {}),
    ...(down !== undefined && down.id !== currentId ? { downId: down.id } : {})
  };
}

function preferBudgetCandidates(parts: Part[], budgetWon: number, share: number, quantity: number | ((part: Part) => number) = 1) {
  const quantityOf = typeof quantity === "function" ? quantity : () => quantity;
  const budgetCandidates = parts.filter((part) => isKnownPrice(part.priceWon) && part.priceWon * quantityOf(part) <= budgetWon * share);
  return budgetCandidates.length > 0 ? budgetCandidates : parts;
}

// RAM 킷 수량은 고정 2개가 아니라 요청 용량을 채우는 최소 킷 수로 정한다.
// 2×16GB 킷(capacityGb=32)은 수량 1로 32GB를 맞춘다 — 고정 2개면 64GB로 과잉이고
// 용량 게이트에 걸려 아예 후보에서 빠졌다.
function memoryKitQuantityFor(part: Part, requestedCapacityGb: number) {
  const kitCapacityGb = part.specs.capacityGb;
  if (kitCapacityGb === undefined || kitCapacityGb <= 0) return 1;
  return Math.max(1, Math.ceil(requestedCapacityGb / kitCapacityGb));
}

// 같은 총용량이면 모듈 2개 이상(듀얼채널) 조합을 우선한다 — 내장그래픽/일반 작업의
// 체감 대역폭이 달라진다. 조합이 하나도 없으면 원래 후보를 유지한다.
function preferDualChannelMemory(parts: Part[], requestedCapacityGb: number) {
  const dual = parts.filter((part) => memoryKitQuantityFor(part, requestedCapacityGb) * (part.specs.memoryModuleCountPerKit ?? 1) >= 2);
  return dual.length > 0 ? dual : parts;
}

// 플랫폼에 맞는 메모리 프로파일을 우선한다 — AM 계열은 EXPO, Intel LGA는 XMP가
// 네이티브 프로파일이라 원클릭 설정이 보장된다. 프로파일 미표기 킷은 후보를 유지한다.
function preferMatchingMemoryProfile(parts: Part[], cpu?: Part) {
  const expected = cpu?.specs.socket?.startsWith("AM") ? "EXPO" : cpu?.specs.socket?.startsWith("LGA") ? "XMP" : undefined;
  if (!expected) return parts;
  const matched = parts.filter((part) => {
    const profiles = part.specs.memoryProfiles;
    return profiles === undefined || profiles.length === 0 || profiles.includes(expected);
  });
  return matched.length > 0 ? matched : parts;
}

function filterGeneratorPoolByMinScore<T extends { parts: Part[]; scores: Map<string, number> }>(pool: T, minScore: number): T {
  if (minScore <= 0) return pool;
  const parts = pool.parts.filter((part) => (pool.scores.get(part.id) ?? 0) >= minScore);
  return parts.length > 0 ? { ...pool, parts } : pool;
}

function filterGeneratorGpuPoolByMinVram<T extends { parts: Part[] }>(pool: T, minVramGb: number): T {
  if (minVramGb <= 0) return pool;
  const parts = pool.parts.filter((part) => typeof part.specs.vramGb === "number" && part.specs.vramGb >= minVramGb);
  return parts.length > 0 ? { ...pool, parts } : pool;
}

// JEDEC 상한을 크게 넘는 고클럭 킷은 플랫폼이 못 쓰는 속도에 돈을 쓰는 것이다.
// CPU 네이티브 상한 +25%와 보드 상한 안쪽 킷을 우선하고, 없으면 전체 후보를 쓴다.
// 단, 관리자가 namePatterns로 지명한 메모리(테스트 베드 허용목록)는 속도 선호
// 컷에서 면제한다 — DDR5-8000급 EXPO 킷처럼 실제로는 플랫폼에서 돌지만 네이티브
// 상한을 넘는 지명 부품이 조용히 사라지는 것을 막기 위해서다.
function preferUsableMemorySpeed(parts: Part[], motherboard: Part, cpu?: Part, targetFilters?: EngineTargetFiltersConfig) {
  const boardLimit = motherboard.specs.maxMemorySpeedMhz ?? Number.POSITIVE_INFINITY;
  const platformLimitFor = (part: Part) => {
    const cpuSpeed = cpuMemorySpeedLimitFor(cpu, part.specs.memoryType ?? motherboard.specs.memoryType);
    return Math.min(cpuSpeed !== undefined ? cpuSpeed * 1.25 : Number.POSITIVE_INFINITY, boardLimit);
  };
  if (cpuMemorySpeedLimitFor(cpu, motherboard.specs.memoryType) === undefined && !Number.isFinite(boardLimit)) return parts;
  const usable = parts.filter((part) => (part.specs.speedMhz ?? 0) <= platformLimitFor(part) || engineTargetFilterNamesPart(part, targetFilters));
  return usable.length > 0 ? usable : parts;
}

// 고발열 GPU를 얇은 보급형 케이스에 넣는 것을 막기 위해 기본 팬 수로 흡기 여유를 우선한다.
function preferCooledCase(parts: Part[], gpu?: Part) {
  const gpuPower = gpu?.specs.powerW ?? 0;
  if (gpuPower < 250) return parts;
  const cooled = parts.filter((part) => (part.specs.fanCount ?? 0) >= 4);
  return cooled.length > 0 ? cooled : parts;
}

function preferRequestedCapacity(parts: Part[], requestedCapacityGb: number, maximumMultiplier = 2) {
  const nearCandidates = parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb <= requestedCapacityGb * maximumMultiplier);
  return nearCandidates.length > 0 ? nearCandidates : parts;
}

// 렌더링/컴파일처럼 올코어 지속부하는 쿨러를 최대치까지 쓴다 — 최대 냉각이
// 발열과 같은 쿨러는 지속부하에서 쓰로틀/소음으로 무너진다. 지속부하 프로필이나
// 고발열 CPU에는 25% 여유 쿨러를 우선하고, 없으면 그대로 둔다.
function preferCoolerHeadroom(parts: Part[], cpu: Part, profile: RecommendationProfile) {
  const cpuHeatW = cpu.specs.pptW ?? cpu.specs.tdpW ?? 0;
  const sustainedLoad = profile === "creator" || profile === "development";
  if (cpuHeatW <= 0 || (!sustainedLoad && cpuHeatW < 150)) return parts;
  const roomy = parts.filter((part) => (part.specs.maxCoolingW ?? 0) >= cpuHeatW * 1.25);
  return roomy.length > 0 ? roomy : parts;
}

function generatedStorageCapacityLabel(capacityGb: number) {
  return capacityGb >= 1000 && capacityGb % 1000 === 0 ? `${capacityGb / 1000}TB` : `${capacityGb}GB`;
}

function generatedPartSpecSummary(part: Part) {
  const specs = part.specs;
  const values: Array<string | undefined> = part.category === "cpu"
    ? [specs.socket ? `소켓 ${specs.socket}` : undefined, specs.cores !== undefined && specs.threads !== undefined ? `${specs.cores}코어/${specs.threads}스레드` : undefined, specs.boostClockGhz !== undefined ? `부스트 ${specs.boostClockGhz}GHz` : undefined, specs.cinebenchR23Multi !== undefined ? `R23 멀티 ${specs.cinebenchR23Multi.toLocaleString("ko-KR")}` : undefined]
    : part.category === "cooler"
      ? [specs.maxCoolingW !== undefined ? `최대 냉각 ${specs.maxCoolingW}W` : undefined, specs.maxCoolerHeightMm !== undefined ? `높이 ${specs.maxCoolerHeightMm}mm` : undefined]
      : part.category === "motherboard"
        ? [specs.socket ? `소켓 ${specs.socket}` : undefined, specs.memoryType, specs.formFactor, specs.wifi === true ? "Wi-Fi 내장" : specs.wifi === false ? "Wi-Fi 없음" : undefined, specs.m2Slots !== undefined ? `M.2 ${specs.m2Slots}개` : undefined, specs.sataPorts !== undefined ? `SATA ${specs.sataPorts}개` : undefined]
        : part.category === "memory"
          ? [specs.capacityGb !== undefined ? `${specs.capacityGb}GB/킷` : undefined, specs.speedMhz !== undefined ? `${specs.speedMhz}MHz` : undefined, specs.memoryCasLatency !== undefined ? `CL${specs.memoryCasLatency}` : undefined, specs.formFactor]
          : part.category === "gpu"
            ? [specs.vramGb !== undefined ? `VRAM ${specs.vramGb}GB` : undefined, specs.powerW !== undefined ? `소비 ${specs.powerW}W` : undefined, specs.lengthMm !== undefined ? `길이 ${specs.lengthMm}mm` : undefined, specs.lowProfileBracket === true ? "LP 브라켓" : undefined, specs.pcieSlotWidth !== undefined ? `PCIe x${specs.pcieSlotWidth}` : undefined]
            : part.category === "ssd"
              ? [specs.interface, specs.formFactor, specs.capacityGb !== undefined ? generatedStorageCapacityLabel(specs.capacityGb) : undefined, specs.m2PcieGeneration !== undefined ? `PCIe ${specs.m2PcieGeneration.toFixed(1)}` : undefined, specs.sequentialReadMbps !== undefined ? `읽기 ${specs.sequentialReadMbps.toLocaleString("ko-KR")}MB/s` : undefined]
              : part.category === "hdd"
                ? [specs.interface, specs.formFactor, specs.capacityGb !== undefined ? generatedStorageCapacityLabel(specs.capacityGb) : undefined]
                : part.category === "case"
                  ? [specs.motherboardFormFactors && specs.motherboardFormFactors.length > 0 ? `보드 ${specs.motherboardFormFactors.join("/")}` : undefined, specs.maxGpuLengthMm !== undefined ? `GPU ≤${specs.maxGpuLengthMm}mm` : undefined, specs.maxCoolerHeightMm !== undefined ? `쿨러 ≤${specs.maxCoolerHeightMm}mm` : undefined, specs.hddBays !== undefined ? `HDD 베이 ${specs.hddBays}개` : undefined, specs.lowProfileOnly === true ? "LP 슬롯 전용" : undefined]
                  : [specs.wattageW !== undefined ? `${specs.wattageW}W` : undefined, specs.psuFormFactor, specs.efficiency];
  return values.filter((value): value is string => Boolean(value && value.trim())).join(" / ");
}

function generatedPartSelectionReason(category: PartCategory, part: Part, state: GeneratorState, request: BuildGenerationRequest, gamingAdvisoryTuning?: GamingAdvisoryTuning, gamingPerformanceAssessment?: GamingPerformanceAssessment) {
  const cpu = state.parts.cpu;
  const motherboard = state.parts.motherboard;
  const cooler = state.parts.cooler;
  const gpu = state.parts.gpu;
  const selectedMemory = state.selection.memory[0];
  const profileLabel = RECOMMENDATION_PROFILE_LABELS[request.profile];
  const priorityLabel = RECOMMENDATION_PRIORITY_LABELS[request.priority ?? "balanced"];
  const valueOrCheck = (value: number | string | undefined, suffix = "") => value === undefined ? "확인 필요" : `${value}${suffix}`;
  if (state.phase1Gaming) {
    if (category === "gpu") return "정해진 그래픽카드 목록에서 다른 필수 부품까지 예산 안에 담을 수 있는 게임용 GPU를 먼저 선택했습니다.";
    if (category === "cooler") return `CPU의 기본 전력 ${valueOrCheck(cpu?.specs.tdpW, "W")}과 ${valueOrCheck(cpu?.specs.socket)} 장착 소켓에 맞는 ${part.specs.coolerType === "liquid" ? `${valueOrCheck(part.specs.radiatorSizeMm, "mm")} 수랭` : /Peerless\s+Assassin/i.test(part.name) ? "듀얼타워" : "싱글타워"} 쿨러를 선택했습니다.`;
    if (category === "motherboard") return `제조사 CPU 지원표와 전원부 냉각 사양을 확인한 ${valueOrCheck(part.specs.socket)}/${part.specs.memoryType ?? "메모리 규격 확인 필요"} 보드입니다. 구매할 제품의 BIOS 버전도 확인해 주세요.`;
    if (category === "case" && cooler?.specs.coolerType === "liquid") return `메인보드와 그래픽카드 장착 조건을 충족하고 ${valueOrCheck(cooler.specs.radiatorSizeMm, "mm")} 라디에이터를 지원하는 케이스입니다. 사용할 라디에이터 장착 위치를 확인해 주세요.`;
    if (category === "psu") return `그래픽카드의 권장 파워와 CPU/주변 부품의 전력 여유를 함께 반영해 ${valueOrCheck(part.specs.wattageW, "W")} 정격을 선택했습니다.`;
  }
  switch (category) {
    case "cpu":
      return `${profileLabel}/${priorityLabel} 기준에서 ${valueOrCheck(part.specs.socket)} 소켓과 ${part.specs.memoryType ?? "메모리 규격 확인 필요"}를 맞추고${part.specs.tdpW !== undefined ? ` ${part.specs.tdpW}W TDP` : ""} 조건을 반영했습니다.`;
    case "cooler":
      return `CPU 발열에 맞춰 최대 냉각 ${valueOrCheck(part.specs.maxCoolingW, "W")}로 CPU 발열 ${valueOrCheck(cpu?.specs.pptW ?? cpu?.specs.tdpW, "W")} 이상을 맞췄습니다.`;
    case "motherboard":
      return `CPU ${valueOrCheck(cpu?.specs.socket, " 소켓")}/${part.specs.memoryType ?? "메모리 규격 확인 필요"}를 맞추고 M.2 ${valueOrCheck(part.specs.m2Slots, "개")}/SATA ${valueOrCheck(part.specs.sataPorts, "개")} 확장 경로를 확인했습니다.`;
    case "memory":
      return `RAM ${request.memoryCapacityGb ?? 16}GB 이상을 맞추는 ${valueOrCheck(part.specs.capacityGb, "GB/킷")} ${selectedMemory?.quantity ?? 2}개 구성으로, ${part.specs.memoryType ?? "규격 확인 필요"}/${valueOrCheck(part.specs.speedMhz, "MHz")}를 CPU/메인보드와 확인했습니다.`;
    case "gpu": {
      const games = request.gamingGameIds?.length ? request.gamingGameIds.map((gameId) => gamingGameOptionFor(gameId)?.label ?? gameId).join("/") : "일반 게이밍";
      const gamingTargetResolution = request.gamingResolution ?? DEFAULT_GAMING_RESOLUTION;
      const targetVramGb = gamingAdvisoryTuning?.targetVramGb ?? GAMING_RESOLUTION_VRAM_TARGETS[gamingTargetResolution];
      const vramText = part.specs.vramGb === undefined
        ? `현재 VRAM 자료가 없어 권장 VRAM ${targetVramGb}GB 기준 확인이 필요합니다`
        : part.specs.vramGb >= targetVramGb
          ? `현재 VRAM ${part.specs.vramGb}GB로 권장 VRAM ${targetVramGb}GB 기준을 충족합니다`
          : `현재 VRAM ${part.specs.vramGb}GB로 권장 VRAM ${targetVramGb}GB보다 낮아 확인이 필요합니다`;
      const evidenceText = gamingPerformanceAssessment?.status === "verified"
        ? `일치하는 실측 FPS 자료 ${gamingPerformanceAssessment.measurements?.length ?? 0}개도 연결했습니다.`
        : gamingPerformanceAssessment?.status === "target_not_met"
          ? "확인한 게임 테스트에서 목표 FPS에 못 미친 조건이 있습니다."
          : "게임별 FPS 측정 자료는 없습니다.";
      return request.profile === "gaming"
        ? `${games}/${GAMING_RESOLUTION_LABELS[gamingTargetResolution]}/${GAMING_REFRESH_RATE_LABELS[request.gamingRefreshRate ?? DEFAULT_GAMING_REFRESH_RATE]} 기준에서 GPU 스펙을 우선 반영했습니다. ${vramText}. ${evidenceText}`
        : `${profileLabel}/${priorityLabel} 기준에서 그래픽 처리 스펙과 예산을 함께 반영했습니다.`;
    }
    case "ssd":
      return `기본 SSD ${generatedStorageCapacityLabel(request.storageCapacityGb ?? 1000)} 이상을 맞추고 ${part.specs.interface ?? "인터페이스 확인 필요"}/${part.specs.formFactor ?? "규격 확인 필요"}를 메인보드 슬롯과 확인했습니다.`;
    case "hdd":
      return `HDD ${request.hddCount ?? 0}개/${request.hddCapacityGb ?? 4000}GB 이상 요청을 맞추고, ${valueOrCheck(part.specs.capacityGb, "GB")} 용량과 SATA 연결을 확인했습니다.`;
    case "case": {
      const fitParts = [
        `${valueOrCheck(motherboard?.specs.formFactor)} 메인보드`,
        gpu ? `GPU ${valueOrCheck(gpu.specs.lengthMm, "mm")}` : undefined,
        cooler ? `쿨러 ${valueOrCheck(cooler.specs.maxCoolerHeightMm, "mm")}` : undefined
      ].filter((value): value is string => value !== undefined);
      return `${fitParts.join("/")} 장착 조건${request.hddCount ? `/HDD 베이 ${valueOrCheck(part.specs.hddBays, "개")}` : ""}을 함께 통과했습니다.`;
    }
    case "psu":
      return gpu
        ? `GPU 권장 파워 ${valueOrCheck(gpu.specs.recommendedPsuW, "W")} 이상을 만족하는 ${valueOrCheck(part.specs.wattageW, "W")} 정격과 ${part.specs.efficiency ?? "효율 확인 필요"}를 반영했습니다.`
        : `시스템 예상 부하에 맞는 ${valueOrCheck(part.specs.wattageW, "W")} 정격과 ${part.specs.efficiency ?? "효율 확인 필요"}를 반영했습니다.`;
    default:
      return `${profileLabel}/${priorityLabel} 기준으로 호환/가격 조건을 확인했습니다.`;
  }
}

function buildGeneratedLines(state: GeneratorState, request: BuildGenerationRequest, gamingAdvisoryTuning?: GamingAdvisoryTuning, gamingPerformanceAssessment?: GamingPerformanceAssessment): GeneratedBuildLine[] {
  const order: PartCategory[] = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu"];
  return order.flatMap((category) => {
    const part = state.parts[category];
    if (!part || !isKnownPrice(part.priceWon)) return [];
    const selection = category === "memory" ? state.selection.memory[0]
      : category === "ssd" ? state.selection.ssd[0]
        : category === "hdd" ? state.selection.hdd[0]
          : state.selection[category];
    if (!selection) return [];
    return [{ category, partId: part.id, name: part.name, quantity: selection.quantity, priceWon: part.priceWon, specSummary: generatedPartSpecSummary(part), selectionReason: generatedPartSelectionReason(category, part, state, request, gamingAdvisoryTuning, gamingPerformanceAssessment) }];
  });
}

type GeneratorCandidatePoolResult = ReturnType<typeof generatorCandidatePool>;

type GeneratorSearchContext = {
  profile: RecommendationProfile;
  priority: RecommendationPriority;
  memoryCapacityGb: number;
  storageCapacityGb: number;
  hddCount: number;
  hddCapacityGb: number;
  performanceTier: RecommendationPerformanceTier | undefined;
  listingPolicy: ListingPolicy;
  includeNonRetail: boolean;
  gamingResolution: GamingResolution;
  gamingRefreshRate: GamingRefreshRate;
  gamingAdvisoryTuning: ReturnType<typeof gamingAdvisoryTuningFor> | undefined;
  cpuPool: GeneratorCandidatePoolResult;
  motherboardPool: GeneratorCandidatePoolResult;
  memoryPool: GeneratorCandidatePoolResult;
  coolerPool: GeneratorCandidatePoolResult;
  casePool: GeneratorCandidatePoolResult;
  ssdPool: GeneratorCandidatePoolResult;
  hddPool: GeneratorCandidatePoolResult | undefined;
  psuPool: GeneratorCandidatePoolResult;
  gpuVendorPreference: GpuVendor | undefined;
  minimumGpuVramGb: number;
  gamingGpuVramFloorGb: number;
  gamingVramReferenceGate: boolean;
  gpuPool: GeneratorCandidatePoolResult | undefined;
  gamingGpuVramThresholdMiss: boolean;
  missingPools: string[];
};

function generatorSearchContextFor(catalog: Part[], request: BuildGenerationRequest, nowMilliseconds: number, targetFilters?: EngineTargetFiltersConfig, phase1Gaming = false): GeneratorSearchContext {
  if (!Number.isFinite(request.budgetWon) || !Number.isInteger(request.budgetWon) || request.budgetWon <= 0) {
    throw new Error("예산은 1원 이상의 정수여야 합니다.");
  }
  const profile = request.profile;
  if (request.priority !== undefined && !["balanced", "budget", "performance", "reliability"].includes(request.priority)) {
    throw new Error("자동 구성 우선순위는 balanced, budget, performance, reliability 중 하나여야 합니다.");
  }
  const priority = request.priority ?? "balanced";
  const memoryCapacityGb = request.memoryCapacityGb ?? 16;
  if (![16, 32, 64, 128].includes(memoryCapacityGb)) {
    throw new Error("RAM 목표 용량은 16, 32, 64, 128GB 중 하나여야 합니다.");
  }
  const gamingResolution = request.gamingResolution === "1080p" || request.gamingResolution === "1440p" || request.gamingResolution === "4k"
    ? request.gamingResolution
    : phase1Gaming ? "1080p" : DEFAULT_GAMING_RESOLUTION;
  const gamingRefreshRate = request.gamingRefreshRate === 60 || request.gamingRefreshRate === 144 || request.gamingRefreshRate === 240
    ? request.gamingRefreshRate
    : DEFAULT_GAMING_REFRESH_RATE;
  const gamingAdvisoryTuning = !phase1Gaming && profile === "gaming"
    ? gamingAdvisoryTuningFor(gamingResolution, {
      gameIds: request.gamingGameIds,
      graphicsPreset: request.gamingGraphicsPreset,
      rayTracing: request.gamingRayTracing,
      upscaling: request.gamingUpscaling
    })
    : undefined;
  const listingPolicy = request.listingPolicy ?? (request.includeNonRetail ? "all" : "retail_only");
  const includeNonRetail = listingPolicy === "all";
  const storageCapacityGb = request.storageCapacityGb ?? 1000;
  const hddCount = request.hddCount ?? 0;
  const hddCapacityGb = request.hddCapacityGb ?? 4000;
  if (!Number.isInteger(storageCapacityGb) || storageCapacityGb <= 0 || !Number.isInteger(hddCount) || hddCount < 0 || hddCount > 8 || !Number.isInteger(hddCapacityGb) || hddCapacityGb <= 0) {
    throw new Error("저장장치 용량과 HDD 개수는 올바른 정수여야 합니다.");
  }
  const performanceTier = !phase1Gaming && (request.performanceTier === "entry" || request.performanceTier === "high" || request.performanceTier === "top") ? request.performanceTier : undefined;
  const cpuCatalog = request.memoryTypePreference === undefined
    ? catalog
    : memoizedCatalogView(catalog, `cpu-memory:${request.memoryTypePreference}`, () => catalog.filter((part) => part.category !== "cpu" || generatorCpuSupportsMemoryPreference(part, request.memoryTypePreference)));
  const cpuPool = filterGeneratorPoolByMinScore(
    generatorCandidatePool(cpuCatalog, "cpu", profile, request.includeGpu ? undefined : (part) => cpuHasIntegratedGraphics(part) === true && (!phase1Gaming || /\b5500GT\b/i.test(part.name)), listingPolicy, gamingResolution, gamingRefreshRate, undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters),
    performanceTier ? GENERATOR_PERFORMANCE_TIER_CPU_MIN_SCORE[performanceTier] : 0
  );
  // 견적 판매 정책으로 스펙 미등록(incomplete) 부품은 후보에서 제외하고,
  // 숫자 전원부 정보가 없는 Intel 보드는 공식 근거가 연결된 정확한 SKU만
  // 먼저 선별한다. 가격/성능 shortlist가 검증된 보드를 제거하지 않게 한다.
  const motherboardPool = generatorCandidatePool(catalog, "motherboard", profile, phase1Gaming && request.cpuVendorPreference === "intel" ? (part) => part.specs.vrmCapacityW !== undefined || phase1IntelMotherboardEvidenceFor(part) !== undefined : undefined, listingPolicy, gamingResolution, gamingRefreshRate, GENERATOR_REQUIRED_FIELDS.motherboard, undefined, undefined, nowMilliseconds, undefined, targetFilters);
  const memoryPool = generatorMemoryPool(catalog, profile, memoryCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate, nowMilliseconds, targetFilters);
  // 수랭 쿨러는 라디에이터 규격/장착 위치가 없으면 케이스 호환 검증이 불가능하다.
  const coolerPool = generatorCandidatePool(catalog, "cooler", profile,
    (part) => phase1Gaming
      ? part.specs.coolerType === "liquid" ? part.specs.radiatorSizeMm !== undefined : part.specs.maxCoolerHeightMm !== undefined
      : part.specs.coolerType !== "liquid" || (part.specs.radiatorSizeMm !== undefined && part.specs.radiatorPosition !== undefined),
    listingPolicy, gamingResolution, gamingRefreshRate, phase1Gaming ? ["supportedSockets"] : undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters, phase1Gaming);
  const casePool = generatorCandidatePool(catalog, "case", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate, generatorCaseRequiredFields(request.includeGpu, hddCount), undefined, undefined, nowMilliseconds, undefined, targetFilters, phase1Gaming);
  const ssdPool = generatorStoragePool(catalog, "ssd", profile, storageCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate, nowMilliseconds, targetFilters);
  if (phase1Gaming && !request.pinnedParts?.ssd) ssdPool.parts = gamingPreferredSsdCandidates(ssdPool.parts, storageCapacityGb);
  const hddPool = hddCount > 0 ? generatorStoragePool(catalog, "hdd", profile, hddCapacityGb, listingPolicy, gamingResolution, gamingRefreshRate, nowMilliseconds, targetFilters) : undefined;
  // GPU 보조전원 단자 정보가 없는 파워는 GPU 견적의 커넥터 검증을 할 수 없다.
  const psuPool = generatorCandidatePool(catalog, "psu", profile, undefined, listingPolicy, gamingResolution, gamingRefreshRate,
    request.includeGpu ? [...(GENERATOR_REQUIRED_FIELDS.psu ?? []), "pciePowerConnectors"] : undefined, undefined, undefined, nowMilliseconds, undefined, targetFilters);
  const gpuVendorPreference: GpuVendor | undefined = request.gpuVendorPreference ?? (request.includeGpu && (
    (profile === "gaming" && request.gamingRayTracing === true)
      || profile === "creator"
      || profile === "development"
  ) ? "nvidia" : undefined);
  const strictPhase1Resolution = phase1Gaming && gamingResolution !== "1080p";
  const minimumGpuVramGb = phase1Gaming ? strictPhase1Resolution ? resolutionVramRequirementFor(gamingResolution) : 0 : Math.max(
    performanceTier ? GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB[performanceTier] : 0,
    profile === "gaming" ? gamingAdvisoryTuning?.targetVramGb ?? GAMING_RESOLUTION_VRAM_TARGETS[gamingResolution] : 0
  );
  // 게이밍 해상도 목표는 "권장" 참고선이다 — 그대로 하드 게이트로 걸면 8GB급
  // 현세대 카드가 전부 빠지고 구형 대용량 카드(RTX 2060 12GB)가 매번 선택된다.
  // 후보 풀 진입은 목표의 2/3 수준을 최소선으로만 두고, 목표 충족 여부는
  // 점수(gpuTargetScoreFor)와 경고로 남긴다. 명시적 성능 등급 요청(tier)은
  // 사용자가 고른 바닥이라 하드 게이트를 유지한다.
  const tierGpuVramFloorGb = performanceTier ? GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB[performanceTier] : 0;
  const gamingGpuVramFloorGb = strictPhase1Resolution ? minimumGpuVramGb : !phase1Gaming && profile === "gaming" && minimumGpuVramGb > 0
    ? Math.max(tierGpuVramFloorGb, Math.ceil(minimumGpuVramGb * 2 / 3))
    : tierGpuVramFloorGb;
  const gamingVramReferenceGate = profile === "gaming" && gamingGpuVramFloorGb > 0;
  const gpuCandidatePool = request.includeGpu
    ? generatorCandidatePool(
        catalog,
        "gpu",
        profile,
        // 보조전원이 필요 없는 카드는 pciePowerOptions가 빈 배열로 선언되므로
        // 존재 여부만 확인한다 — 빈 배열도 유효한 데이터다.
        // 단, 관리자가 이름으로 직접 지명한 부품(테스트 베드)은 커넥터 데이터가
        // 없어도 후보에 남기고 평가 단계가 "확인 필요"로 표시하게 한다.
        (part) => (part.specs.pciePowerOptions !== undefined || engineTargetFilterNamesPart(part, targetFilters)) && (!phase1Gaming || phase1GpuPowerUpperBoundW(part) !== undefined),
        listingPolicy,
        gamingResolution,
        gamingRefreshRate,
        phase1Gaming ? ["recommendedPsuW", "lengthMm", "thicknessMm"] : GENERATOR_REQUIRED_FIELDS.gpu ?? [],
        gamingAdvisoryTuning,
        gpuVendorPreference,
        nowMilliseconds,
        gamingVramReferenceGate
          ? (part) => phase1Gaming
            ? phase1GpuMeetsResolution(part, gamingResolution)
            : (typeof part.specs.vramGb === "number" && part.specs.vramGb >= gamingGpuVramFloorGb) || engineTargetFilterNamesPart(part, targetFilters)
          : undefined,
        targetFilters,
        phase1Gaming
      )
    : undefined;
  // A gaming reference threshold is a candidate gate, not a compatibility or
  // FPS guarantee. Other profiles retain their existing tier preference.
  const gpuPool = gpuCandidatePool && !gamingVramReferenceGate
    ? filterGeneratorGpuPoolByMinVram(gpuCandidatePool, minimumGpuVramGb)
    : gpuCandidatePool;
  const gamingGpuVramThresholdMiss = gamingVramReferenceGate
    && gpuCandidatePool !== undefined
    && gpuCandidatePool.candidateCount > 0
    && gpuCandidatePool.eligibleCandidateCount === 0;
  if (phase1Gaming && !request.pinnedParts?.cpu) {
    const shortlisted = cpuPool.parts.filter((cpu) => cpuGamingEvidenceFor(cpu) !== undefined && (!hasPubgGameContext(request.gamingGameIds) || /X3D\b/i.test(`${cpu.name} ${cpu.model ?? ""}`)));
    const platformCostFor = (cpu: Part) => {
      const boards = motherboardPool.parts.filter((board) => generatorCpuCanUseMotherboard(cpu, board, true));
      const stock = cpu.specs.coolerIncluded === true && (cpu.specs.pptW ?? cpu.specs.tdpW ?? 999) <= 100;
      const coolerCost = stock ? 0 : Math.min(...coolerPool.parts.filter((cooler) => generatorCoolerCanUseCpu(cooler, cpu, true)).map((cooler) => cooler.priceWon ?? Infinity));
      return (cpu.priceWon ?? Infinity) + coolerCost + Math.min(...boards.map((board) => (board.priceWon ?? Infinity) + Math.min(...memoryPool.parts.filter((ram) => generatorMemoryCanUseMotherboard(ram, board, cpu, memoryCapacityGb, engineTargetFilterNamesPart(ram, targetFilters))).map((ram) => (ram.priceWon ?? Infinity) * memoryKitQuantityFor(ram, memoryCapacityGb)))));
    };
    cpuPool.parts = cpuGamingValueFrontier(shortlisted, platformCostFor);
  }
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
  ].filter(([, count]) => count === 0).map(([label]) => String(label));
  return {
    profile,
    priority,
    memoryCapacityGb,
    storageCapacityGb,
    hddCount,
    hddCapacityGb,
    performanceTier,
    listingPolicy,
    includeNonRetail,
    gamingResolution,
    gamingRefreshRate,
    gamingAdvisoryTuning,
    cpuPool,
    motherboardPool,
    memoryPool,
    coolerPool,
    casePool,
    ssdPool,
    hddPool,
    psuPool,
    gpuVendorPreference,
    minimumGpuVramGb,
    gamingGpuVramFloorGb,
    gamingVramReferenceGate,
    gpuPool,
    gamingGpuVramThresholdMiss,
    missingPools
  };
}

// 외장 GPU 구성이 요청 예산에 맞지 않으면 내장 그래픽 견적으로 한 번 더 시도한다.
// 80만원대 진입 견적은 실시간 GPU 최저가 때문에 외장 구성이 불가능한 경우가
// 흔하고, 이때 내장 GPU CPU(5500GT 등)로 구성을 돌려주는 게 실패보다 유용하다.
// 다른 종류의 실패(후보 풀 없음 등)는 그대로 던진다.
function strictPhase1ResolutionMessageFor(phase1Gaming: boolean, resolution: GamingResolution): string | undefined {
  if (!phase1Gaming || resolution === "1080p") return undefined;
  return `${GAMING_RESOLUTION_LABELS[resolution]} 추천 기준의 ${resolutionGpuReferenceFor(resolution)?.minimumGpuModel ? `${resolutionGpuReferenceFor(resolution)!.minimumGpuModel} 이상, ` : ""}VRAM ${resolutionVramRequirementFor(resolution)}GB 이상인 GPU를 찾지 못했습니다. 실제 게임 성능은 게임/옵션별로 확인해야 합니다.`;
}
function phase1GpuMeetsResolution(gpu: Part, resolution: GamingResolution): boolean {
  if (resolution === "1080p") return true;
  return (gpu.specs.vramGb ?? 0) >= resolutionVramRequirementFor(resolution) && gpuMeetsResolutionReference(gpu,resolution);
}
function phase1CpuMeetsReference(cpu: Part | undefined, gpu: Part | undefined, request: BuildGenerationRequest): boolean {
  if (hasPubgGameContext(request.gamingGameIds) && !/X3D\b/i.test(`${cpu?.name ?? ""} ${cpu?.model ?? ""}`)) return false;
  return cpuMeetsGamingGpuFloor(cpu,gpu,request.cpuVendorPreference,request.gamingGameIds);
}

// 요청 조건으로 거른 카탈로그 뷰는 같은 카탈로그·같은 조건이면 내용이 같다.
// 요청마다 새 배열을 만들면 카탈로그 참조를 키로 쓰는 캐시(트윈 인덱스, seed
// 억제 판정, 세대 경계, 분석 점수)가 매번 처음부터 다시 계산되므로 뷰를 재사용한다.
// 반환 배열은 공유되므로 호출부는 수정하지 않는다.
const catalogViewCache = new WeakMap<readonly Part[], Map<string, Part[]>>();

function memoizedCatalogView(catalog: Part[], key: string, build: () => Part[]): Part[] {
  let views = catalogViewCache.get(catalog);
  if (!views) {
    views = new Map();
    catalogViewCache.set(catalog, views);
  }
  const cached = views.get(key);
  if (cached) return cached;
  const view = build();
  views.set(key, view);
  return view;
}

function phase1GenerationInputs(catalog: Part[], request: BuildGenerationRequest, options: EngineGenerationOptions) {
  if (request.profile !== "gaming" || (options.gamingTestbedPhase1 !== true && request.gamingTestbedPhase1 !== true && request.gamingMode === undefined)) return { catalog, request, options };
  const resolution = request.gamingResolution ?? "1080p";
  if ((request.storageCapacityGb ?? 1000) < 500) throw new BuildGenerationError("게임 견적 SSD는 500GB 이상 선택해 주세요.",[{id:"phase1-ssd-capacity",title:"SSD 최소 용량은 500GB입니다.",summary:"검증한 SSD 모델에서 500GB 이상을 선택해 주세요.",facts:[]}]);
  if (resolution !== "1080p" && !request.includeGpu && !request.pinnedParts?.gpu) throw new BuildGenerationError("요청 해상도의 추천 견적에는 외장 그래픽카드가 필요합니다.",[{id:"resolution-gpu-reference",title:"외장 GPU가 필요합니다.",summary:"QHD/4K 추천 기준은 CPU 내장 그래픽 구성으로 대체하지 않습니다.",facts:[]}]);
  const requestedGpu = catalog.find(part=>part.id===request.pinnedParts?.gpu && part.category==="gpu");
  if (requestedGpu && !phase1GpuMeetsResolution(requestedGpu,resolution)) throw new BuildGenerationError("선택한 GPU가 요청 해상도의 추천 기준에 부족합니다.",[{id:"resolution-gpu-reference",title:"선택한 GPU의 해상도 기준이 부족합니다.",summary:`${GAMING_RESOLUTION_LABELS[resolution]} 추천 기준은 ${resolutionGpuReferenceFor(resolution)?.minimumGpuModel ? `${resolutionGpuReferenceFor(resolution)!.minimumGpuModel} 이상, ` : ""}VRAM ${resolutionVramRequirementFor(resolution)}GB 이상입니다. 실제 게임 성능은 게임/옵션별로 확인해야 합니다.`,facts:[{label:"선택 GPU",value:requestedGpu.name}]}]);
  const filteredCatalog = memoizedCatalogView(catalog, `phase1:${request.gpuVendorPreference ?? ""}|${request.cpuVendorPreference ?? ""}|${request.memoryTypePreference ?? ""}|${request.pinnedParts?.ssd !== undefined}`, () => catalog.filter((part) => phase1GamingPartAllowed(part, request.gpuVendorPreference, request.cpuVendorPreference))
    .filter((part) => part.category !== "cpu" || request.cpuVendorPreference === undefined || (request.cpuVendorPreference === "intel" ? /Intel|인텔|코어/i.test(part.name) : /AMD|라이젠|Ryzen/i.test(part.name)))
    .filter((part) => request.memoryTypePreference === undefined || !["motherboard", "memory"].includes(part.category) || part.specs.memoryType === request.memoryTypePreference)
    .filter((part) => part.category !== "ssd" || request.pinnedParts?.ssd !== undefined || gamingSsdFamilyAllowed(part) || gamingFallbackSsdAllowed(part)));
  const targetFilters = phase1GamingFilters(options.targetFilters, request.gpuVendorPreference, request.cpuVendorPreference);
  if (request.pinnedParts?.ssd) targetFilters.categories.ssd = { ...targetFilters.categories.ssd, namePatterns: [".*"], brands: undefined };
  const listingPolicy = request.listingPolicy === "all" || request.includeNonRetail ? "include_bulk" as const : request.listingPolicy ?? "retail_only" as const;
  for (const [category, partId] of Object.entries(request.pinnedParts ?? {})) {
    const part = filteredCatalog.find((candidate) => candidate.id === partId && candidate.category === category);
    const allowIncomplete = category === "case" || category === "cooler" || category === "gpu";
    const requiredFields = category === "case" ? generatorCaseRequiredFields(request.includeGpu || request.pinnedParts?.gpu !== undefined, request.hddCount ?? 0) : category === "cooler" ? ["supportedSockets", part?.specs.coolerType === "liquid" ? "radiatorSizeMm" : "maxCoolerHeightMm"] : category === "gpu" ? ["recommendedPsuW", "lengthMm", "thicknessMm"] : GENERATOR_REQUIRED_FIELDS[category as PartCategory] ?? [];
    if (!part || !generatorPartQuoteSelectable(part, filteredCatalog, true, allowIncomplete) || !generatorHasFields(part, requiredFields) || (category === "gpu" && phase1GpuPowerUpperBoundW(part) === undefined) || (!engineTargetFilterBypassesBrandPolicy(targetFilters, category as PartCategory) && !isQuoteBrandAllowed(category as PartCategory, part.brand, part.name)) || !isListingAllowed(part, listingPolicy) || !engineTargetFiltersAllowPart(part, targetFilters)) {
      throw new BuildGenerationError("이 부품은 현재 게임 견적에 사용할 수 없습니다.", [{
        id: "phase1-pinned-part",
        title: "선택한 부품을 게임 견적에 사용할 수 없습니다.",
        summary: "선택할 수 있는 부품 중 국내에서 판매하는 신품을 골라 주세요.",
        facts: [{ label: "부품 종류", value: CATEGORY_LABELS[category as PartCategory] ?? category }]
      }]);
    }
  }
  const pinnedCpu = filteredCatalog.find((part) => part.id === request.pinnedParts?.cpu);
  const pinnedMotherboard = filteredCatalog.find((part) => part.id === request.pinnedParts?.motherboard);
  const pinnedCooler = filteredCatalog.find((part) => part.id === request.pinnedParts?.cooler);
  if (pinnedCpu && ((pinnedMotherboard && !generatorCpuCanUseMotherboard(pinnedCpu, pinnedMotherboard, true)) || (pinnedCooler && !generatorCoolerCanUseCpu(pinnedCooler, pinnedCpu, true)))) {
    throw new BuildGenerationError("선택한 부품이 CPU의 전원부/냉각 조건과 맞지 않습니다.", [{
      id: "phase1-incompatible-pins",
      title: "선택한 CPU와 보드/쿨러를 함께 사용할 수 없습니다.",
      summary: "제조사 CPU 지원과 소켓, 기본 전력 설정의 전원부/냉각 조건을 만족하는 조합을 선택해 주세요.",
      facts: [{ label: "고정 CPU", value: pinnedCpu.name }]
    }]);
  }
  return {
    catalog: filteredCatalog,
    request: {
      ...request,
      gamingResolution: resolution,
      // Changing an integrated-graphics CPU to an F/non-G model also requires
      // a display-output GPU; never return a non-bootable CPU-only adjustment.
      includeGpu: request.includeGpu || request.pinnedParts?.gpu !== undefined || (request.pinnedParts?.cpu !== undefined && cpuHasIntegratedGraphics(filteredCatalog.find((part) => part.id === request.pinnedParts?.cpu)!) === false),
      // Even an existing all-listings preset must not reintroduce overseas prices.
      listingPolicy
    },
    options: { ...options, gamingTestbedPhase1: true, targetFilters, referenceBuilds: [] }
  };
}

export function generateBuildDraft(catalog: Part[], request: BuildGenerationRequest, gamingPerformanceEvidence: readonly GamingPerformanceEvidenceRecord[] = [], options: EngineGenerationOptions = {}): BuildGenerationResult {
  ({ catalog, request, options } = phase1GenerationInputs(catalog, request, options));
  try {
    let draft = generateBuildDraftCore(catalog, request, gamingPerformanceEvidence, options);
    if (request.gamingMode === "target_fps") draft = targetGamingDraftFor(catalog, request, gamingPerformanceEvidence, options, draft);
    if (request.gamingMode === "budget" && options.gamingTestbedPhase1) {
      const gpu = catalog.find((part) => part.id === draft.selection.gpu?.partId);
      const appropriate = gamingAppropriateMemoryCapacityGb(gpu, request.memoryCapacityGb ?? 16);
      if (appropriate > (draft.memoryCapacityGb ?? 16) && !request.pinnedParts?.memory) {
        try {
          const upgraded = generateBuildDraftCore(catalog, { ...request, memoryCapacityGb: appropriate, pinnedParts: { ...request.pinnedParts, cpu: draft.selection.cpu!.partId, gpu: draft.selection.gpu?.partId } }, gamingPerformanceEvidence, options);
          if (upgraded.withinBudget && upgraded.blockerCount === 0) draft = upgraded;
        } catch { /* Keep the strongest affordable GPU when the RAM step does not fit. */ }
      }
    }
    return draft;
  } catch (error) {
    const budgetInfeasible = error instanceof BuildGenerationError
      && error.diagnostics.some((diagnostic) => diagnostic.id === "budget-infeasible");
    if (budgetInfeasible && options.gamingTestbedPhase1 && request.gamingResolution !== "1080p") {
      const label = GAMING_RESOLUTION_LABELS[request.gamingResolution ?? "1080p"];
      throw new BuildGenerationError(`요청 예산으로는 ${label} 추천 기준을 갖춘 견적을 만들 수 없습니다. 예산이나 해상도를 선택해 주세요.`, [
        ...error.diagnostics,
        { id: "resolution-budget", title: `${label} 추천 기준에 예산이 부족합니다.`, summary: "해상도별 GPU 체급/VRAM과 CPU 조합 기준을 유지하면 현재 예산을 넘습니다. 실제 게임 성능을 보장하는 기준은 아닙니다.", facts: [{label:"요청 예산",value:formatPrice(request.budgetWon)},{label:"요청 해상도",value:label}], recommendation:"예산을 늘리거나 현재 예산의 FHD 견적 또는 해상도 추천 견적을 선택해 주세요." }
      ]);
    }
    // GPU가 고정된 ± 조정은 내장 그래픽으로 숨기면 고정 의미가 무너진다.
    if (request.gamingMode === "target_fps" || hasPubgGameContext(request.gamingGameIds) || (options.gamingTestbedPhase1 && request.gamingResolution !== "1080p") || !budgetInfeasible || request.includeGpu !== true || request.pinnedParts?.gpu !== undefined) throw error;
    const fallback = generateBuildDraftCore(catalog, { ...request, includeGpu: false }, gamingPerformanceEvidence, options);
    fallback.warnings = [
      "예산 안에서 외장 그래픽카드 구성을 찾지 못해 내장 그래픽(CPU 통합 그래픽) 구성으로 바꿨어요. 외장 그래픽을 원하면 예산을 올려 다시 시도해 주세요.",
      ...fallback.warnings
    ];
    return fallback;
  }
}

function targetGamingDraftFor(catalog: Part[], request: BuildGenerationRequest, legacyEvidence: readonly GamingPerformanceEvidenceRecord[], options: EngineGenerationOptions, fallback: BuildGenerationResult) {
  const refs = options.gamingFpsReferences ?? [];
  const candidates: BuildGenerationResult[] = [fallback];
  // Enumerate the cheapest product for each measured GPU/CPU model. This keeps
  // the measured CPU in the frontier instead of losing it in GPU-first pruning.
  const requestedMemoryCapacityGb = request.memoryCapacityGb ?? 16;
  const groups = new Map<string, {cpu: Part; gpu: Part; memoryCapacitiesGb: Set<number>}>();
  for (const ref of refs) {
    if (!(request.gamingGameIds ?? []).includes(ref.gameId) || ref.resolution !== (request.gamingResolution ?? DEFAULT_GAMING_RESOLUTION)
      || ref.graphicsPreset !== (request.gamingGraphicsPreset ?? "high") || ref.rayTracing !== (request.gamingRayTracing ?? false)
      || ref.upscaling !== (request.gamingUpscaling ?? "native") || ref.frameGeneration) continue;
    const cpus = catalog.filter((part) => part.category === "cpu" && gamingCpuModelFor(part.name) === gamingCpuModelFor(ref.cpuModel) && (!request.pinnedParts?.cpu || part.id === request.pinnedParts.cpu));
    const gpus = catalog.filter((part) => part.category === "gpu" && gamingGpuModelFor(part.name) === gamingGpuModelFor(ref.gpuModel) && part.specs.vramGb === ref.gpuVramGb && (!request.pinnedParts?.gpu || part.id === request.pinnedParts.gpu));
    const eligible = (parts: Part[]) => parts.filter((part) => {
      if (!isKnownPrice(part.priceWon)) return false;
      try { phase1GenerationInputs(catalog, { ...request, pinnedParts: { ...request.pinnedParts, [part.category]: part.id } }, options); return true; } catch { return false; }
    }).sort((a,b) => a.priceWon! - b.priceWon!);
    const cpu = eligible(cpus)[0];
    for (const gpu of eligible(gpus).slice(0, 3)) {
      if (!cpu) continue;
      const key = `${cpu.id}|${gpu.id}`;
      const group = groups.get(key) ?? {cpu, gpu, memoryCapacitiesGb: new Set([requestedMemoryCapacityGb])};
      // A reference without RAM capacity cannot justify a larger kit. When it
      // is recorded, try matching it without reducing the user's minimum.
      if (ref.memoryCapacityGb !== undefined && Number.isInteger(ref.memoryCapacityGb) && ref.memoryCapacityGb > 0) {
        const sourceCapacityGb = [16, 32, 64, 128].find((capacity) => capacity >= Math.max(requestedMemoryCapacityGb, ref.memoryCapacityGb!));
        if (sourceCapacityGb !== undefined) group.memoryCapacitiesGb.add(sourceCapacityGb);
      }
      groups.set(key, group);
    }
  }
  for (const {cpu,gpu,memoryCapacitiesGb} of [...groups.values()].slice(0, 16)) {
    for (const memoryCapacityGb of memoryCapacitiesGb) {
      try {
        const checked = phase1GenerationInputs(catalog, { ...request, includeGpu: true, memoryCapacityGb, pinnedParts: {...request.pinnedParts, cpu: cpu.id, gpu: gpu.id} }, options);
        const candidate = generateBuildDraftCore(checked.catalog, checked.request, legacyEvidence, checked.options);
        if (candidate.withinBudget && candidate.blockerCount === 0) candidates.push(candidate);
      } catch { /* A recorded pair or matching RAM can still exceed this budget or fail physical fit. */ }
    }
  }
  const sourceCpuMatches = (draft: BuildGenerationResult) => draft.gamingTargetAssessment?.measurements.every(({sourceConditions}) => gamingCpuModelFor(sourceConditions.cpuModel) === gamingCpuModelFor(draft.gamingTargetAssessment?.cpuName));
  const completeTargetReferences = candidates.filter((draft) => draft.gamingTargetAssessment?.referenceTargetMet && sourceCpuMatches(draft));
  const conditionMatchRank = (draft: BuildGenerationResult) => draft.gamingTargetAssessment?.targetMet ? 2 : draft.gamingTargetAssessment?.estimatedTargetMet === true ? 1 : 0;
  if (completeTargetReferences.length) return completeTargetReferences.sort((a,b) => conditionMatchRank(b) - conditionMatchRank(a) || a.totalPriceWon - b.totalPriceWon)[0];
  return fallback;
}

function generateBuildDraftCore(catalog: Part[], request: BuildGenerationRequest, gamingPerformanceEvidence: readonly GamingPerformanceEvidenceRecord[] = [], options: EngineGenerationOptions = {}): BuildGenerationResult {
  const nowMilliseconds = engineNowMilliseconds(options.now);
  const phase1Gaming = request.profile === "gaming" && options.gamingTestbedPhase1 === true;
  const {
    profile,
    priority,
    memoryCapacityGb,
    storageCapacityGb,
    hddCount,
    hddCapacityGb,
    performanceTier,
    listingPolicy,
    includeNonRetail,
    gamingResolution,
    gamingRefreshRate,
    gamingAdvisoryTuning,
    cpuPool,
    motherboardPool,
    memoryPool,
    coolerPool,
    casePool,
    ssdPool,
    hddPool,
    psuPool,
    gpuVendorPreference,
    minimumGpuVramGb,
    gamingGpuVramFloorGb,
    gpuPool,
    gamingGpuVramThresholdMiss,
    missingPools
  } = generatorSearchContextFor(catalog, request, nowMilliseconds, options.targetFilters, phase1Gaming);
  const referenceBuilds = options.referenceBuilds ?? REFERENCE_BUILDS;
  if (missingPools.length > 0) {
    const hasMissingPoolsApartFromGpu = missingPools.some((label) => label !== "그래픽카드");
    const diagnostics: BuildGenerationDiagnostic[] = [];
    if (gamingGpuVramThresholdMiss && gpuPool?.parts.length === 0) {
      diagnostics.push({
        id: "gaming-gpu-vram-target",
        title: "요청 조건을 충족하는 GPU 후보가 없습니다.",
        summary: strictPhase1ResolutionMessageFor(phase1Gaming,gamingResolution) ?? `현재 GPU 후보 중 요청 조건의 최소 VRAM ${gamingGpuVramFloorGb}GB 이상인 제품을 찾지 못했습니다(권장 기준 ${minimumGpuVramGb}GB). VRAM 기준은 후보를 좁히기 위한 참고선이며 실제 게임 성능이나 부품 호환성을 보장하지 않습니다.`,
        facts: [
          { label: "요청 해상도", value: GAMING_RESOLUTION_LABELS[gamingResolution] },
          { label: "권장 VRAM 참고 기준", value: `${minimumGpuVramGb}GB` },
          { label: "최소 VRAM 기준", value: `${gamingGpuVramFloorGb}GB` },
          { label: "기준 충족 GPU", value: "0개" }
        ],
        recommendation: "해상도나 그래픽 설정을 조정하거나, VRAM 정보가 확인된 GPU 후보가 추가된 뒤 다시 시도해 주세요."
      });
    }
    if (diagnostics.length === 0 || hasMissingPoolsApartFromGpu) {
      diagnostics.push({
        id: "candidate-pools",
        title: "자동 구성에 필요한 부품 데이터가 부족합니다.",
        summary: `요청 조건에서 ${missingPools.join(", ")} 부품을 확인된 가격/필수 스펙 기준으로 찾지 못했습니다.`,
        facts: [
          { label: "CPU 부품", value: `${cpuPool.parts.length}개` },
          { label: "메인보드 부품", value: `${motherboardPool.parts.length}개` },
          { label: "RAM 부품", value: `${memoryPool.parts.length}개` },
          { label: "GPU 부품", value: `${gpuPool?.parts.length ?? 0}개` },
          { label: "SSD 부품", value: `${ssdPool.parts.length}개` },
          { label: "PSU 부품", value: `${psuPool.parts.length}개` }
        ],
        recommendation: "구매 조건/용량/외장 GPU 포함 여부를 조정하거나 부품 데이터가 보강된 뒤 다시 시도해 주세요."
      });
    }
    const message = gamingGpuVramThresholdMiss && gpuPool?.parts.length === 0
      ? `요청한 게임 조건에 맞는 GPU 후보를 찾지 못했습니다: VRAM 참고 기준 ${minimumGpuVramGb}GB를 충족하는 후보가 없습니다.`
      : `자동 구성에 필요한 확인된 데이터가 부족합니다: ${missingPools.join(", ")}`;
    throw new BuildGenerationError(message, diagnostics);
  }

  // Conservative lower bounds for required categories that have not been
  // expanded yet. These ignore state-specific compatibility and budget-share
  // filters, so they can underestimate but cannot overstate completion cost.
  const minimumRemainingPartCost: Partial<Record<PartCategory, number>> = {
    motherboard: minimumPositiveGeneratorCost(motherboardPool.parts),
    memory: minimumPositiveGeneratorCost(memoryPool.parts, (part) => memoryKitQuantityFor(part, memoryCapacityGb)),
    cooler: minimumPositiveGeneratorCost(coolerPool.parts),
    ...(gpuPool ? { gpu: minimumPositiveGeneratorCost(gpuPool.parts) } : {}),
    case: minimumPositiveGeneratorCost(casePool.parts),
    ssd: minimumPositiveGeneratorCost(ssdPool.parts.filter((part) => (part.specs.capacityGb ?? 0) >= storageCapacityGb)),
    ...(hddCount > 0 && hddPool ? {
      hdd: minimumPositiveGeneratorCost(
        hddPool.parts.filter((part) => (part.specs.capacityGb ?? 0) >= hddCapacityGb),
        () => hddCount
      )
    } : {}),
    psu: minimumPositiveGeneratorCost(psuPool.parts)
  };
  const generatorStages: PartCategory[] = [
    "cpu",
    "motherboard",
    "memory",
    "cooler",
    ...(request.includeGpu ? ["gpu" as const] : []),
    "case",
    "ssd",
    ...(hddCount > 0 ? ["hdd" as const] : []),
    "psu"
  ];
  // A request keeps the same PSU pool and GPU objects throughout expansion.
  // Reuse this exact lower bound instead of scanning PSUs for every state and
  // again for every pruning comparison. Preserve zero/Infinity unchanged.
  const minimumPsuCostByGpu = new Map<Part, number>();
  const remainingGeneratorCostAfter = (stage: PartCategory): RemainingGeneratorCostForState => (state) => {
    const stageIndex = generatorStages.indexOf(stage);
    if (stageIndex < 0) return 0;
    return generatorStages.slice(stageIndex + 1).reduce((total, category) => {
      if (category === "cooler") {
        const cpu = state.parts.cpu;
        const stockCoolerAvailable = cpu?.specs.coolerIncluded === true
          && (cpu.specs.pptW ?? cpu.specs.tdpW ?? 999) <= 100;
        if (stockCoolerAvailable) return total;
      }
      if (category === "psu") {
        // 파워 하한은 이 상태의 GPU가 요구하는 최소 용량으로 잰다 — 대형 카드는
        // 전역 최저가(보조전원 없는 저용량)로 추정하면 완주 불가 조합이 끝까지
        // 살아남아 자리만 차지한다. 호환 PSU가 없는 GPU는 완주 불가로 처리.
        const gpu = state.parts.gpu;
        if (!gpu) return total + (minimumRemainingPartCost.psu ?? 0);
        let floor = minimumPsuCostByGpu.get(gpu);
        if (floor === undefined) {
          floor = minimumPositiveGeneratorCost(psuPool.parts.filter((part) => generatorPsuCanUseGpu(part, gpu)));
          minimumPsuCostByGpu.set(gpu, floor);
        }
        return total + (floor > 0 ? floor : Number.POSITIVE_INFINITY);
      }
      return total + (minimumRemainingPartCost[category] ?? 0);
    }, 0);
  };

  const base: GeneratorState = {
    selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: !request.includeGpu },
    parts: {},
    priceWon: 0,
    capabilityScore: 0,
    rankingPriority: priority,
    gamingGameIds: request.gamingGameIds,
    ...(phase1Gaming ? { phase1Gaming: true, phase1BudgetWon: request.budgetWon } : {})
  };
  // ± 밸런스 조정(고정 부품) — 지정 카테고리는 그 부품으로 고정하고 나머지를
  // 다시 맞춘다. 고정된 조합의 실제 가격을 보여주는 게 목적이므로 완주 컷만
  // 느슨하게 두고, 후보 폭/점수는 원래 예산 기준을 유지한다.
  const partById = new Map(catalog.map((part) => [part.id, part]));
  const pinnedParts: Partial<Record<PartCategory, Part>> = {};
  for (const [category, partId] of Object.entries(request.pinnedParts ?? {})) {
    const part = partId === undefined ? undefined : partById.get(partId);
    if (part !== undefined && part.category === category) pinnedParts[category as PartCategory] = part;
  }
  const hasPinnedParts = Object.keys(pinnedParts).length > 0;
  const feasibilityBudgetWon = hasPinnedParts ? Math.max(request.budgetWon, 10_000_000_000) : request.budgetWon;
  const cpuCandidates = cpuPool.parts.filter((part) => (request.includeGpu || cpuHasIntegratedGraphics(part) === true) && (!phase1Gaming || !pinnedParts.gpu || pinnedParts.cpu !== undefined || phase1CpuMeetsReference(part,pinnedParts.gpu,request)));
  let states = expandGeneratorStates([base], "cpu", () => pinnedParts.cpu ? [pinnedParts.cpu] : preferBudgetCandidates(cpuCandidates, request.budgetWon, 0.35), cpuPool.scores, profile, feasibilityBudgetWon, undefined, Math.max(160, cpuPool.parts.length), remainingGeneratorCostAfter("cpu"), (_state, part) => referenceCpuScoreAdjustmentFor(part, profile, request.budgetWon, referenceBuilds));
  if (states.length === 0) throw new Error("선택한 사용 목적에 맞는 CPU 부품을 찾지 못했습니다.");
  states = expandGeneratorStates(states, "motherboard", (state) => {
    const cpu = state.parts.cpu;
    if (pinnedParts.motherboard) return !phase1Gaming || (cpu && generatorCpuCanUseMotherboard(cpu, pinnedParts.motherboard, true)) ? [pinnedParts.motherboard] : [];
    const compatible = cpu ? motherboardPool.parts.filter((part) => generatorCpuCanUseMotherboard(cpu, part, phase1Gaming)) : [];
    return phase1Gaming ? compatible : preferBudgetCandidates(compatible, request.budgetWon, 0.2);
  }, motherboardPool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("motherboard"));
  const cpuMotherboardPairCount = cpuPool.parts.reduce((total, cpu) => total + motherboardPool.parts.filter((motherboard) => generatorCpuCanUseMotherboard(cpu, motherboard, phase1Gaming)).length, 0);
  requireGeneratorStates(states, "CPU와 소켓/전원부가 맞는 메인보드 부품을 찾지 못했습니다.", [{
    id: "cpu-motherboard-pair",
    title: "CPU와 메인보드의 호환쌍이 남지 않았습니다.",
    summary: "현재 부품에서 소켓/메모리 타입/전원부를 동시에 만족하는 연결을 먼저 찾지 못했습니다.",
    facts: [
      { label: "CPU 부품", value: `${cpuPool.parts.length}개` },
      { label: "메인보드 부품", value: `${motherboardPool.parts.length}개` },
      { label: "호환쌍", value: `${cpuMotherboardPairCount}개` }
    ],
    recommendation: "구매 조건을 넓히거나 다른 CPU/메인보드 조합을 선택해 다시 시도해 주세요."
  }]);
  states = expandGeneratorStates(states, "memory", (state) => {
    if (pinnedParts.memory) return [pinnedParts.memory];
    const motherboard = state.parts.motherboard;
    const cpu = state.parts.cpu;
    const compatible = motherboard ? memoryPool.parts.filter((part) => generatorMemoryCanUseMotherboard(part, motherboard, cpu, memoryCapacityGb, engineTargetFilterNamesPart(part, options.targetFilters))) : [];
    if (phase1Gaming) return preferDualChannelMemory(cheapestGeneratorCandidates(compatible, (part) => memoryKitQuantityFor(part, memoryCapacityGb)), memoryCapacityGb);
    return motherboard ? preferBudgetCandidates(preferMatchingMemoryProfile(preferDualChannelMemory(preferUsableMemorySpeed(compatible, motherboard, cpu, options.targetFilters), memoryCapacityGb), cpu), request.budgetWon, 0.16, (part) => memoryKitQuantityFor(part, memoryCapacityGb)) : [];
  }, memoryPool.scores, profile, feasibilityBudgetWon, (part) => memoryKitQuantityFor(part, memoryCapacityGb), 160, remainingGeneratorCostAfter("memory"));
  requireGeneratorStates(states, `${memoryCapacityGb}GB 이상이며 메인보드와 규격/용량/속도가 맞는 RAM 부품을 찾지 못했습니다.`, [{
    id: "memory-motherboard-fit",
    title: "요청 RAM 조건을 만족하는 메인보드 연결이 없습니다.",
    summary: "RAM 용량/속도/프로파일/물리 모듈 수와 CPU/메인보드 상한을 함께 통과하는 부품이 남지 않았습니다.",
    facts: [
      { label: "RAM 부품", value: `${memoryPool.parts.length}개` },
      { label: "요청 용량", value: `${memoryCapacityGb}GB 이상` },
      { label: "기본 킷 수량", value: "2개" }
    ],
    recommendation: "RAM 목표 용량/속도 조건을 낮추거나 메인보드 부품을 바꿔 다시 시도해 주세요."
  }]);
  const statesBeforeCooler = states;
  // 번들 쿨러가 있는 저발열 CPU는 사제 쿨러를 사지 않는 경로도 남긴다.
  // 예산 컷 throw가 스톡 병합보다 먼저 일어나면(쿨러 후보 전멸) 스톡 경로가
  // 영영 막히므로, 예산 전멸 오류만 스톡 경로가 존재할 때 넘긴다.
  const stockCoolerStates = statesBeforeCooler.filter((state) => {
    const cpu = state.parts.cpu;
    return !pinnedParts.cooler && cpu?.specs.coolerIncluded === true && (cpu.specs.pptW ?? cpu.specs.tdpW ?? 999) <= 100;
  });
  try {
    states = expandGeneratorStates(states, "cooler", (state) => {
      const cpu = state.parts.cpu;
      if (pinnedParts.cooler) return !phase1Gaming || (cpu && generatorCoolerCanUseCpu(pinnedParts.cooler, cpu, true)) ? [pinnedParts.cooler] : [];
      const compatible = cpu ? coolerPool.parts.filter((part) => generatorCoolerCanUseCpu(part, cpu, phase1Gaming)) : [];
      return phase1Gaming ? compatible : cpu ? preferBudgetCandidates(preferCoolerHeadroom(compatible, cpu, profile), request.budgetWon, 0.1) : [];
    }, coolerPool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("cooler"));
  } catch (error) {
    if (!(error instanceof BuildGenerationError) || error.diagnostics[0]?.id !== "budget-infeasible" || stockCoolerStates.length === 0) throw error;
    states = [];
  }
  if (stockCoolerStates.length > 0) {
    states = pruneGeneratorStates([...states, ...stockCoolerStates], request.budgetWon, 160, remainingGeneratorCostAfter("cooler"));
  }
  requireGeneratorStates(states, "CPU 소켓/발열과 맞는 CPU 쿨러 부품을 찾지 못했습니다.", [{
    id: "cpu-cooler-fit",
    title: "CPU의 소켓/발열 조건을 만족하는 쿨러가 없습니다.",
    summary: "현재 CPU 부품과 쿨러 부품의 지원 소켓/최대 냉각 용량을 함께 통과하지 못했습니다.",
    facts: [
      { label: "CPU 부품 상태", value: `${states.length}개 조합` },
      { label: "쿨러 부품", value: `${coolerPool.parts.length}개` }
    ],
    recommendation: "CPU 쿨러 부품을 확인하거나 사용 목적/예산 조건을 조정해 주세요."
  }]);
  if (request.includeGpu && gpuPool) {
    const gpuVendorMatched = gpuVendorPreference ? preferGpuVendor(gpuPool.parts, gpuVendorPreference) : gpuPool.parts;
    const gpuMinVram = profile === "creator" || profile === "development" ? 12 : 0;
    const gpuCandidates = gpuMinVram > 0 ? preferMinGpuVram(gpuVendorMatched, gpuMinVram) : gpuVendorMatched;
    if (GENERATOR_DEBUG) {
      const vrams = gpuCandidates.map((p) => p.specs.vramGb ?? -1);
      console.error(`[generator] gpuPool: ${gpuCandidates.length} parts, vram min=${Math.min(...vrams)} max=${Math.max(...vrams)}, vramFloor=${gamingGpuVramFloorGb} target=${minimumGpuVramGb}`);
    }
    // GPU는 게이밍 견적의 성능 축이라 예산의 대부분을 쓸 수 있어야 한다 —
    // 0.6 상한이면 400만 구성에서 250만짜리 카드도 후보에서 빠진다.
    states = expandGeneratorStates(states, "gpu", (state) => pinnedParts.gpu ? (!phase1Gaming || pinnedParts.cpu || phase1CpuMeetsReference(state.parts.cpu,pinnedParts.gpu,request) ? [pinnedParts.gpu] : []) : phase1Gaming ? gpuCandidates.filter((gpu) => pinnedParts.cpu !== undefined || phase1CpuMeetsReference(state.parts.cpu, gpu, request)) : preferBudgetCandidates(gpuCandidates, request.budgetWon, profile === "gaming" ? 0.7 : 0.6), gpuPool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("gpu"), (state, part) => referenceGpuScoreAdjustmentFor(state.parts.cpu, part, profile, request.budgetWon, referenceBuilds));
    requireGeneratorStates(states, "외장 그래픽카드와 앞선 부품 조건을 함께 만족하는 부품을 찾지 못했습니다.", [{
      id: "gpu-fit",
      title: "앞선 부품과 함께 사용할 그래픽카드가 없습니다.",
      summary: "GPU 부품을 연결한 뒤 케이스 장착 길이/전력 조건을 적용하기 전에 조합이 남지 않았습니다.",
      facts: [
        { label: "선택 가능한 그래픽카드", value: `${gpuPool.parts.length}개` },
        { label: "외장 GPU", value: "포함" }
      ],
      recommendation: "외장 GPU를 제외하거나 구매 조건/예산을 조정해 다시 시도해 주세요."
    }]);
  }
  states = expandGeneratorStates(states, "case", (state) => {
    const motherboard = state.parts.motherboard;
    if (!motherboard) return [];
    if (pinnedParts.case) return !phase1Gaming || generatorCaseCanUseParts(pinnedParts.case, motherboard, state.parts.cooler, state.parts.gpu, hddCount, true) ? [pinnedParts.case] : [];
    const compatible = preferCooledCase(casePool.parts.filter((part) => generatorCaseCanUseParts(part, motherboard, state.parts.cooler, state.parts.gpu, hddCount, phase1Gaming)), state.parts.gpu);
    return phase1Gaming ? compatible : preferBudgetCandidates(preferValueCase(compatible), request.budgetWon, 0.15);
  }, casePool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("case"));
  requireGeneratorStates(states, "메인보드/쿨러/저장장치/GPU가 들어가는 케이스 부품을 찾지 못했습니다.", [{
    id: "case-fit",
    title: "선택한 부품을 함께 수용하는 케이스가 없습니다.",
    summary: "메인보드 폼팩터/쿨러 높이/GPU 길이/파워 길이와 요청 저장장치 조건을 동시에 만족하는 케이스가 남지 않았습니다.",
    facts: [
      { label: "케이스 부품", value: `${casePool.parts.length}개` },
      { label: "GPU 포함", value: request.includeGpu ? "예" : "아니오" },
      { label: "HDD 요청", value: `${hddCount}개` }
    ],
    recommendation: "GPU/HDD 수량을 낮추거나 장착 여유가 큰 케이스를 선택해 주세요."
  }]);
  const statesBeforeSsd = states;
  states = expandGeneratorStates(states, "ssd", (state) => {
    if (pinnedParts.ssd) return [pinnedParts.ssd];
    const motherboard = state.parts.motherboard;
    const compatible = motherboard ? preferRequestedCapacity(ssdPool.parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb >= storageCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, undefined, hddCount, phase1Gaming)), storageCapacityGb) : [];
    return phase1Gaming ? cheapestGeneratorCandidates(compatible, (part) => 1 / (part.specs.capacityGb ?? 1)) : preferBudgetCandidates(preferValueStorage(compatible), request.budgetWon, 0.15);
  }, ssdPool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("ssd"));
  requireGeneratorStates(states, `${storageCapacityGb.toLocaleString("ko-KR")}GB 이상 SSD를 포함한 호환 조합을 찾지 못했습니다.`, [{
    id: "storage-fit",
    title: "요청 저장장치 조건을 만족하는 연결이 없습니다.",
    summary: "SSD 용량/인터페이스/PCIe 세대와 메인보드 슬롯/SATA 포트, 요청한 HDD 수량을 함께 확인했지만 조합이 남지 않았습니다.",
    facts: [
      { label: "요청 SSD", value: `${storageCapacityGb.toLocaleString("ko-KR")}GB 이상` },
      { label: "선택 가능한 SSD", value: `${ssdPool.parts.length}개` },
      { label: "요청 HDD", value: `${hddCount}개` },
      { label: "부품 메인보드", value: [...new Set(statesBeforeSsd.map((state) => state.parts.motherboard?.id).filter((id): id is string => Boolean(id)))].length + "개" }
    ],
    recommendation: "SSD 목표 용량을 낮추거나 HDD 수량을 줄여 SATA/M.2 연결 여유를 확보해 주세요."
  }]);
  if (hddCount > 0 && hddPool) {
    const statesBeforeHdd = states;
    states = expandGeneratorStates(states, "hdd", (state) => {
      if (pinnedParts.hdd) return [pinnedParts.hdd];
      const motherboard = state.parts.motherboard;
      const ssd = state.parts.ssd;
      return motherboard
        ? preferBudgetCandidates(preferRequestedCapacity(hddPool.parts.filter((part) => part.specs.capacityGb !== undefined && part.specs.capacityGb >= hddCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, ssd, hddCount)), hddCapacityGb), request.budgetWon, 0.3, hddCount)
        : [];
    }, hddPool.scores, profile, feasibilityBudgetWon, hddCount, 160, remainingGeneratorCostAfter("hdd"));
    requireGeneratorStates(states, `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상 HDD ${hddCount}개를 포함한 호환 조합을 찾지 못했습니다.`, [{
      id: "hdd-fit",
      title: "요청 HDD 수량을 수용하는 연결/장착 공간이 없습니다.",
      summary: "HDD 용량/SATA 포트/케이스 베이를 함께 확인했지만 요청 개수를 충족하는 조합이 남지 않았습니다.",
      facts: [
        { label: "요청 HDD", value: `${hddCount}개` },
        { label: "요청 용량", value: `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상` },
        { label: "선택 가능한 HDD", value: `${hddPool?.parts.length ?? 0}개` },
        { label: "앞선 조합", value: `${statesBeforeHdd.length}개` }
      ],
      recommendation: "HDD 수량/용량을 낮추거나 SATA 포트와 베이가 더 많은 메인보드/케이스를 선택해 주세요."
    }]);
  }
  states = expandGeneratorStates(states, "psu", (state) => {
    if (pinnedParts.psu) return !phase1Gaming || (generatorPsuCanUseGpu(pinnedParts.psu, state.parts.gpu) && (pinnedParts.psu.specs.wattageW ?? 0) >= estimateSystemPowerW(state)) ? [pinnedParts.psu] : [];
    const compatible = preferAdequatePsu(psuPool.parts.filter((part) => generatorPsuCanUseGpu(part, state.parts.gpu) && (!phase1Gaming || (part.specs.wattageW ?? 0) >= estimateSystemPowerW(state))), state);
    return phase1Gaming ? compatible : preferBudgetCandidates(compatible, request.budgetWon, 0.25);
  }, psuPool.scores, profile, feasibilityBudgetWon, undefined, 160, remainingGeneratorCostAfter("psu"));
  requireGeneratorStates(states, "그래픽카드와 시스템 전력에 맞는 파워서플라이 부품을 찾지 못했습니다.", [{
    id: "gpu-psu-fit",
    title: "그래픽카드와 시스템 전력에 맞는 파워가 없습니다.",
    summary: "그래픽카드 권장 파워 용량과 파워서플라이 정격 출력 조건을 함께 만족하지 못했습니다.",
    facts: [
      { label: "파워 부품", value: `${psuPool.parts.length}개` },
      { label: "외장 GPU", value: request.includeGpu ? "포함" : "미포함" }
    ],
    recommendation: "그래픽카드를 낮추거나 더 높은 정격 출력의 파워서플라이를 선택해 주세요."
  }]);

  const gamingEvidenceForState = (state: GeneratorState) => {
    if (phase1Gaming || request.gamingMode === "target_fps" || profile !== "gaming" || !request.gamingGameIds?.length || !state.parts.gpu) return undefined;
    return gamingPerformanceAssessmentFor(gamingPerformanceEvidence, {
      gameIds: request.gamingGameIds.slice(0, 5),
      resolution: gamingResolution,
      refreshRate: gamingRefreshRate,
      graphicsPreset: request.gamingGraphicsPreset ?? "balanced",
      rayTracing: request.gamingRayTracing ?? false,
      upscaling: request.gamingUpscaling ?? "quality",
      gpuPartId: state.parts.gpu.id,
      gpuName: state.parts.gpu.name
    });
  };
  const fitUnknownCountFor = (evaluation: CompatibilityResult) => evaluation.findings.filter((finding) => finding.severity === "unknown" && !GENERATOR_COSMETIC_UNKNOWN_RULES.has(finding.ruleId)).length;
  const evaluated = states.map((state) => {
    const evaluation = evaluateBuild(state.selection, catalog, { includeSuggestions: false });
    const gamingEvidence = gamingEvidenceForState(state);
    return { state, evaluation, gamingEvidence, fitUnknownCount: fitUnknownCountFor(evaluation) };
  });
  // FPS evidence is an internal ranking signal: complete, current target-met measurements
  // lead; partial current evidence follows; unsupported candidates remain eligible as
  // fallbacks; stale or measured-below-target candidates rank last.
  const gamingEvidenceRank = (status: GamingPerformanceAssessment["status"] | undefined) => {
    switch (status) {
      case "verified": return 4;
      case "partial": return 3;
      case "missing": return 2;
      case "target_not_met": return 1;
      case "stale": return 0;
      default: return 2;
    }
  };
  const ranked = evaluated.sort((a, b) => {
    // 장착 미확인(fitUnknown)은 유효성에서 분리해 점수 감점으로만 반영한다.
    // 크롤링 스펙이 얇은 조합(수랭 쿨러 + 라디에이터 정보 없는 케이스)이
    // 단 한 번의 미확인으로 훨씬 나은 구성 아래로 구조적으로 밀려나는 걸 막고,
    // 최종 상태는 fitUnknownCount가 남아 needs_review로 표시된다.
    const aValid = a.evaluation.blockerCount === 0;
    const bValid = b.evaluation.blockerCount === 0;
    // 예산을 넘는 구성은 순위와 관계없이 최종 견적으로 반환하지 않는다.
    // 단 ± 고정 조정(pinnedParts)은 예산 초과 가격도 보여주는 게 목적이라 완화 예산을 쓴다.
    const aWithin = a.state.priceWon <= feasibilityBudgetWon;
    const bWithin = b.state.priceWon <= feasibilityBudgetWon;
    const overBudgetPenalty = (entry: typeof a) => Math.max(0, entry.state.priceWon - request.budgetWon) / Math.max(request.budgetWon, 1) * 2000;
    // 호환 경고/장착 미확인은 점수 페널티로 반영한다. lexicographic 거부로 두면
    // 경고 1개가 훨씬 나은 구성을 무조건 밀어내, 예산 대부분을 쓰지 않는 하위
    // 견적이 선택됐다.
    const priorityValue = (entry: typeof a) => phase1Gaming ? phase1GeneratorStateScore(entry.state, request.budgetWon) : (priority === "budget"
      ? -entry.state.priceWon / 10_000 - overBudgetPenalty(entry)
      : priority === "performance"
        ? entry.state.capabilityScore - overBudgetPenalty(entry)
        : priority === "reliability"
          ? generatorStateReliabilityScoreFor(entry.state) - overBudgetPenalty(entry)
          : generatorStateScore(entry.state, request.budgetWon)) - entry.evaluation.warningCount * GENERATOR_WARNING_SCORE_PENALTY - entry.fitUnknownCount * GENERATOR_FIT_UNKNOWN_SCORE_PENALTY;
    return Number(bValid) - Number(aValid)
      || Number(bWithin) - Number(aWithin)
      || a.evaluation.blockerCount - b.evaluation.blockerCount
      || gamingEvidenceRank(b.gamingEvidence?.status) - gamingEvidenceRank(a.gamingEvidence?.status)
      || priorityValue(b) - priorityValue(a)
      || a.evaluation.warningCount - b.evaluation.warningCount
      || a.state.priceWon - b.state.priceWon;
  });
  const budgetCandidates = ranked.filter((entry) => entry.state.priceWon <= feasibilityBudgetWon);
  const chosen = budgetCandidates[0];
  if (!chosen) {
    const leastExpensive = ranked.reduce<(typeof ranked)[number] | undefined>(
      (best, entry) => !best || entry.state.priceWon < best.state.priceWon ? entry : best,
      undefined
    );
    throw new BuildGenerationError(
      `요청 예산 ${formatPrice(request.budgetWon)} 안에 자동 구성을 찾지 못했습니다.`,
      [{
        id: "budget-infeasible",
        title: "요청 예산 안에 자동 구성이 없습니다.",
        summary: "요청한 조건으로 생성한 모든 구성의 합계가 예산을 넘어 최종 견적을 제공하지 않았습니다.",
        facts: [
          { label: "요청 예산", value: formatPrice(request.budgetWon) },
          { label: "예산 내 생성 조합", value: "0개" },
          ...(leastExpensive ? [{ label: "가장 저렴한 조합", value: formatPrice(leastExpensive.state.priceWon) }] : [])
        ],
        recommendation: "예산을 늘리거나 외장 GPU/RAM/SSD 조건을 조정해 다시 찾아보세요."
      }]
    );
  }
  if (phase1Gaming && chosen.evaluation.blockerCount > 0) {
    const blockers = chosen.evaluation.findings.filter((finding) => finding.severity === "blocker");
    throw new BuildGenerationError("선택한 부품을 함께 사용할 수 있는 게임 견적을 찾지 못했습니다.", [{
      id: "phase1-incompatible-pins",
      title: "선택한 부품의 호환 조건이 맞지 않습니다.",
      summary: blockers.map((finding) => finding.title).join(" "),
      facts: blockers.slice(0, 4).map((finding) => ({ label: "호환 확인", value: finding.title })),
      recommendation: "맞지 않는 부품의 고정을 풀거나 다른 부품을 선택해 주세요."
    }]);
  }
  if (GENERATOR_DEBUG) {
    for (const entry of ranked.slice(0, 12)) {
      const parts = Object.entries(entry.state.parts).map(([category, part]) => `${category}=${part?.id}`).join(" ");
      console.error(`[generator] ranked price=${entry.state.priceWon} capability=${Math.round(entry.state.capabilityScore)} valid=${entry.evaluation.blockerCount === 0 && entry.fitUnknownCount === 0} blockers=${entry.evaluation.blockerCount} fitUnknowns=${entry.fitUnknownCount} unknowns=${entry.evaluation.unknownCount} warnings=${entry.evaluation.warningCount} evidence=${entry.gamingEvidence?.status ?? "-"} :: ${parts}`);
    }
    const bestRankPerGpu = new Map<string, { rank: number; price: number; capability: number; blockers: number; fitUnknowns: number; warnings: number; name?: string; unknownRules: string }>();
    ranked.forEach((entry, i) => {
      const gpu = entry.state.parts.gpu;
      const id = gpu?.id ?? "none";
      const prev = bestRankPerGpu.get(id);
      if (!prev) bestRankPerGpu.set(id, {
        rank: i, price: entry.state.priceWon, capability: Math.round(entry.state.capabilityScore),
        blockers: entry.evaluation.blockerCount, fitUnknowns: entry.fitUnknownCount, warnings: entry.evaluation.warningCount,
        name: gpu?.name,
        unknownRules: entry.evaluation.findings.filter((f) => f.severity === "unknown" || f.severity === "blocker" || f.severity === "warning").map((f) => f.ruleId).join("+")
      });
    });
    const gpuRanked = [...bestRankPerGpu.entries()].sort((a, b) => a[1].rank - b[1].rank).slice(0, 20);
    for (const [id, info] of gpuRanked) {
      console.error(`[generator] gpu-rank #${info.rank} ${id} price=${info.price} cap=${info.capability} bl=${info.blockers} fu=${info.fitUnknowns} w=${info.warnings} [${info.unknownRules}] ${info.name?.slice(0, 45)}`);
    }
  }
  // Manual ± uses the declared model/capacity ladder, never recommendation rank.
  const partTiers: Partial<Record<PartCategory, GeneratedPartTierAdjacency>> = {};
  const adjustmentPoolFor = (category: PartCategory, predicate?: (part: Part) => boolean, requiredFields?: string[], allowIncomplete = false) =>
    generatorCandidatePool(catalog, category, profile, predicate, listingPolicy, gamingResolution, gamingRefreshRate, requiredFields, undefined, undefined, nowMilliseconds, undefined, options.targetFilters, allowIncomplete, true);
  const adjustmentCpuPool = phase1Gaming ? adjustmentPoolFor("cpu", (part) => generatorCpuSupportsMemoryPreference(part, request.memoryTypePreference)) : cpuPool;
  const adjustmentGpuPool = phase1Gaming
    ? adjustmentPoolFor("gpu", (part) => (part.specs.pciePowerOptions !== undefined || engineTargetFilterNamesPart(part, options.targetFilters)) && phase1GpuPowerUpperBoundW(part) !== undefined && (part.specs.vramGb ?? 0) >= gamingGpuVramFloorGb, ["recommendedPsuW", "lengthMm", "thicknessMm"], true)
    : gpuPool;
  const adjustmentMemoryPool = phase1Gaming ? adjustmentPoolFor("memory") : memoryPool;
  const adjustmentSsdPool = phase1Gaming ? adjustmentPoolFor("ssd", (part) => (part.specs.capacityGb ?? 0) >= 500) : ssdPool;
  const adjustmentHddPool = phase1Gaming && hddCount > 0 ? adjustmentPoolFor("hdd", (part) => (part.specs.capacityGb ?? 0) >= 2000) : hddPool;
  const adjustmentMotherboardPool = phase1Gaming ? adjustmentPoolFor("motherboard", request.cpuVendorPreference === "intel" ? (part) => part.specs.vrmCapacityW !== undefined || phase1IntelMotherboardEvidenceFor(part) !== undefined : undefined, GENERATOR_REQUIRED_FIELDS.motherboard) : motherboardPool;
  const adjustmentCoolerPool = phase1Gaming ? adjustmentPoolFor("cooler", (part) => part.specs.coolerType === "liquid" ? part.specs.radiatorSizeMm !== undefined : part.specs.maxCoolerHeightMm !== undefined, ["supportedSockets"], true) : coolerPool;
  const adjustmentCasePool = phase1Gaming ? adjustmentPoolFor("case", undefined, generatorCaseRequiredFields(Boolean(chosen.state.parts.gpu), hddCount), true) : casePool;
  const adjustmentPsuPool = phase1Gaming ? adjustmentPoolFor("psu", undefined, chosen.state.parts.gpu ? [...(GENERATOR_REQUIRED_FIELDS.psu ?? []), "pciePowerConnectors"] : undefined) : psuPool;
  const tierPools: Array<[PartCategory, { parts: Part[]; scores: Map<string, number> } | undefined]> = [
    ["cpu", adjustmentCpuPool], ["cooler", adjustmentCoolerPool], ["motherboard", adjustmentMotherboardPool], ["gpu", adjustmentGpuPool],
    ["case", adjustmentCasePool], ["psu", adjustmentPsuPool], ["memory", adjustmentMemoryPool], ["ssd", adjustmentSsdPool], ["hdd", adjustmentHddPool]
  ];
  for (const [category, pool] of tierPools) {
    const current = chosen.state.parts[category];
    if (!pool || !current) continue;
    // The selected SKU may have been pinned outside recommendation slices.
    const parts = pool.parts.some((part) => part.id === current.id) ? pool.parts : [...pool.parts, current];
    const adjacency = phase1Gaming
      ? gamingPartTierAdjacencyFor(category === "ssd" || category === "hdd"
        ? parts.filter((part) => part.id === current.id || chosen.state.parts.motherboard && generatorStorageCanUseMotherboard(part, chosen.state.parts.motherboard, category === "hdd" ? chosen.state.parts.ssd : undefined, hddCount, true))
        : parts, current.id, { ...chosen.state.parts, memoryCapacityGb, memoryQuantity: chosen.state.selection.memory.reduce((sum, item) => sum + item.quantity, 0), hddCount })
      : generatorPartTierAdjacency(parts, pool.scores, current.id);
    if (adjacency.upId !== undefined || adjacency.downId !== undefined || adjacency.downUseIncludedCooler || adjacency.upUnavailableReason || adjacency.downUnavailableReason) partTiers[category] = adjacency;
  }
  if (phase1Gaming && !chosen.state.parts.gpu && adjustmentGpuPool) {
    const firstGpu = [...adjustmentGpuPool.parts].sort((a, b) => phase1GpuGamingClass(a) - phase1GpuGamingClass(b) || (a.priceWon ?? 0) - (b.priceWon ?? 0))[0];
    if (firstGpu) partTiers.gpu = { upId: firstGpu.id };
  }
  if (phase1Gaming && !chosen.state.parts.cooler && chosen.state.parts.cpu) {
    // Included stock cooler has exactly one adjacent step: the single tower.
    // A missing/unsuitable single tower must not silently become dual/water.
    const singleTowers = adjustmentCoolerPool.parts.filter((part) => /DEEPCOOL\s+AG400\s+G2\b/i.test(part.name));
    const firstCooler = singleTowers.filter((part) => generatorCoolerCanUseCpu(part, chosen.state.parts.cpu!, true)).sort((a,b) => (a.priceWon ?? Infinity)-(b.priceWon ?? Infinity) || a.id.localeCompare(b.id))[0];
    partTiers.cooler = firstCooler ? { upId: firstCooler.id } : { upUnavailableReason: "싱글 타워 단계의 판매 가능한 쿨러 또는 CPU 장착 조건이 없습니다." };
  }
  const tierAssessment = phase1Gaming ? gamingTierAssessmentFor(chosen.state.parts, { memoryCapacityGb, memoryQuantity: chosen.state.selection.memory.reduce((sum, item) => sum + item.quantity, 0), hddCount }) : undefined;
  const gamingTargetAssessment = gamingTargetAssessmentForBuild(chosen.state.selection, catalog, request, options.gamingFpsReferences ?? [], nowMilliseconds);
  const performanceMetrics = buildPerformanceReportFor(chosen.state.parts);
  const cpuGpuBalance = cpuGpuBalanceFor(chosen.state.parts.cpu, chosen.state.parts.gpu, chosen.state.parts.motherboard?.specs.memoryType, request.gamingGameIds);
  const generatedEvaluation = evaluateBuild(chosen.state.selection, catalog, {
    includeSuggestions: false,
    includeAnalysis: true,
    recommendationPreferences: {
      profile,
      priority,
      ...(performanceTier ? { performanceTier } : {}),
      gamingResolution,
      gamingRefreshRate,
      ...(request.gamingGameIds?.length ? { gamingGameIds: request.gamingGameIds.slice(0, 5) } : {}),
      ...(request.gamingGraphicsPreset ? { gamingGraphicsPreset: request.gamingGraphicsPreset } : {}),
      ...(request.gamingRayTracing !== undefined ? { gamingRayTracing: request.gamingRayTracing } : {}),
      ...(request.gamingUpscaling ? { gamingUpscaling: request.gamingUpscaling } : {}),
      listingPolicy,
      budgetWon: request.budgetWon
    }
  });
  const totalPriceWon = chosen.state.priceWon;
  const tierMinGpuVramGb = performanceTier ? GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB[performanceTier] : 0;
  const chosenGpuVramGb = chosen.state.parts.gpu?.specs.vramGb;
  const tierGpuUnmet = performanceTier !== undefined && request.includeGpu && tierMinGpuVramGb > 0 && (chosenGpuVramGb === undefined || chosenGpuVramGb < tierMinGpuVramGb);
  const tierMinCpuScore = performanceTier ? GENERATOR_PERFORMANCE_TIER_CPU_MIN_SCORE[performanceTier] : 0;
  const tierCpuUnmet = performanceTier !== undefined && tierMinCpuScore > 0 && chosen.state.parts.cpu !== undefined && (cpuPool.scores.get(chosen.state.parts.cpu.id) ?? 0) < tierMinCpuScore;
  const budgetDeltaWon = totalPriceWon - request.budgetWon;
  const withinBudget = budgetDeltaWon <= 0;
  const gpuTarget = !phase1Gaming && profile === "gaming" && request.includeGpu && chosen.state.parts.gpu
    ? gpuTargetEvidenceFor(chosen.state.parts.gpu, undefined, gamingResolution, gamingRefreshRate, gamingAdvisoryTuning?.targetVramGb)
    : undefined;
  const hasGamingOptionAdvisory = !phase1Gaming && request.gamingMode !== "target_fps" && profile === "gaming" && (
    (request.gamingGameIds?.length ?? 0) > 0
    || request.gamingGraphicsPreset !== undefined
    || request.gamingRayTracing !== undefined
    || request.gamingUpscaling !== undefined
  );
  const selectedGamingGpu = chosen.state.parts.gpu;
  const gamingPerformanceAssessment = hasGamingOptionAdvisory
    ? gamingPerformanceAssessmentFor(gamingPerformanceEvidence, {
      gameIds: request.gamingGameIds ?? [],
      resolution: gamingResolution,
      refreshRate: gamingRefreshRate,
      graphicsPreset: request.gamingGraphicsPreset ?? "balanced",
      rayTracing: request.gamingRayTracing ?? false,
      upscaling: request.gamingUpscaling ?? "quality",
      // A measured result is only usable when it belongs to the GPU that was
      // actually selected. The sentinel keeps integrated-graphics drafts from
      // accidentally inheriting a discrete-GPU measurement.
      gpuPartId: selectedGamingGpu?.id ?? "__integrated_graphics__",
      ...(selectedGamingGpu ? { gpuName: selectedGamingGpu.name } : {})
    })
    : undefined;
  const gamingEvidenceStatus = gamingPerformanceAssessment?.status;
  const warnings = chosen.evaluation.findings
    .filter((finding) =>
      (finding.severity === "warning" || finding.severity === "unknown" || finding.severity === "blocker") &&
      !(finding.severity === "unknown" && GENERATOR_COSMETIC_UNKNOWN_RULES.has(finding.ruleId))
    )
    .map((finding) => finding.title);
  if (phase1IntelStockCpuPowerFor(chosen.state.parts.cpu)) warnings.unshift("Intel Default Settings를 사용하고, 구매할 보드의 CPU 지원 BIOS와 13/14세대 안정성 개선 마이크로코드를 확인해 주세요.");
  if (cpuGpuBalance?.cpu.level === "slightly_weak") warnings.unshift("이 그래픽카드에 비해 CPU 성능이 살짝 낮습니다.");
  if (cpuGpuBalance?.cpu.level === "too_weak") warnings.unshift("이 그래픽카드에 비해 CPU 성능이 너무 낮습니다.");
  if (gamingTargetAssessment) warnings.unshift(gamingTargetAssessment.note);
  if (gpuTarget?.currentFit === "partial") warnings.unshift(`선택한 그래픽카드 VRAM ${gpuTarget.currentVramGb}GB은 ${GAMING_RESOLUTION_LABELS[gamingResolution]} 게임의 요구 사양보다 낮을 수 있어요. 구매 전에 플레이할 게임의 권장 사양을 확인해 주세요.`);
  if (gpuTarget?.currentFit === "unknown") warnings.unshift(`${gpuTarget.summary}. GPU VRAM을 제조사 페이지에서 확인해 주세요.`);
  if (tierGpuUnmet) warnings.push(`${RECOMMENDATION_PERFORMANCE_TIER_LABELS[performanceTier]}에 맞는 그래픽카드를 예산 안에서 찾지 못해 요청한 성능보다 낮은 부품으로 구성했어요. (VRAM ${tierMinGpuVramGb}GB 이상 필요)`);
  if (tierCpuUnmet) warnings.push(`${RECOMMENDATION_PERFORMANCE_TIER_LABELS[performanceTier]}에 맞는 CPU를 예산 안에서 찾지 못해 요청한 성능보다 낮은 부품으로 구성했어요.`);
  if (hasGamingOptionAdvisory) {
    if (gamingEvidenceStatus === "verified") {
      warnings.unshift("확인한 테스트에서는 목표 FPS에 도달했어요. 실제 성능은 게임 업데이트와 PC 환경에 따라 달라질 수 있습니다.");
    } else if (gamingEvidenceStatus === "target_not_met") {
      warnings.unshift("확인한 테스트 중 목표 FPS에 못 미친 조건이 있어요. 그래픽 설정을 낮추거나 예산을 조정해 보세요.");
    } else {
      warnings.unshift("이 설정에서 몇 FPS가 나올지는 확인되지 않았어요.");
    }
  }
  const gamingOptionRationale = hasGamingOptionAdvisory
    ? `게임별 목표와 그래픽 설정을 권장 VRAM ${gamingAdvisoryTuning?.targetVramGb ?? GAMING_RESOLUTION_VRAM_TARGETS[gamingResolution]}GB와 GPU 추천에 반영했습니다.${gamingEvidenceStatus === "verified" ? " 선택한 GPU의 테스트 결과에서 목표 FPS에 도달했습니다." : gamingEvidenceStatus === "target_not_met" ? " 확인한 테스트에서 목표 FPS에 못 미친 조건이 있어요. 그래픽 설정이나 예산을 조정해 보세요." : " 같은 설정의 FPS 테스트는 아직 없어요."}`
    : undefined;
  return {
    selection: chosen.state.selection,
    profile,
    priority,
    ...(phase1Gaming ? { gamingTestbedPhase1: true } : {}),
    ...(request.cpuVendorPreference ? { cpuVendorPreference: request.cpuVendorPreference } : {}),
    ...(request.memoryTypePreference ? { memoryTypePreference: request.memoryTypePreference } : {}),
    ...(cpuGpuBalance ? { cpuGpuBalance } : {}),
    ...(request.gamingMode ? { gamingMode: request.gamingMode } : {}),
    ...(request.gamingTargetFps ? { gamingTargetFps: request.gamingTargetFps } : {}),
    ...(request.gpuVendorPreference ? { gpuVendorPreference: request.gpuVendorPreference } : {}),
    ...(gamingTargetAssessment ? { gamingTargetAssessment } : {}),
    ...(tierAssessment ? { gamingSupportRequirements: tierAssessment.requirements, partTierSuitability: tierAssessment.categories } : {}),
    ...(performanceTier ? { performanceTier } : {}),
    gamingResolution,
    gamingRefreshRate,
    ...(request.gamingGameIds?.length ? { gamingGameIds: request.gamingGameIds.slice(0, 5) } : {}),
    ...(request.gamingGraphicsPreset ? { gamingGraphicsPreset: request.gamingGraphicsPreset } : {}),
    ...(request.gamingRayTracing !== undefined ? { gamingRayTracing: request.gamingRayTracing } : {}),
    ...(request.gamingUpscaling ? { gamingUpscaling: request.gamingUpscaling } : {}),
    ...(gamingPerformanceAssessment ? { gamingPerformanceAssessment } : {}),
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
    status: chosen.evaluation.blockerCount > 0 ? "incompatible" : chosen.fitUnknownCount > 0 ? "needs_review" : "compatible",
    blockerCount: chosen.evaluation.blockerCount,
    warningCount: chosen.evaluation.warningCount,
    unknownCount: chosen.evaluation.unknownCount,
    lines: buildGeneratedLines(chosen.state, request, gamingAdvisoryTuning, gamingPerformanceAssessment),
    ...(Object.keys(partTiers).length > 0 ? { partTiers } : {}),
    ...(Object.keys(performanceMetrics).length > 0 ? { performanceMetrics } : {}),
    rationale: [
      profileSummaryFor(profile),
      phase1Gaming
        ? request.gamingMode === "target_fps" ? "선택한 게임과 옵션의 FPS 테스트를 참고해 CPU와 그래픽카드를 비교했습니다." : "예산 안에서 그래픽카드 성능을 먼저 높이고, 남는 금액으로 CPU를 골랐어요."
        : priority === "reliability"
        ? `${RECOMMENDATION_PRIORITY_LABELS[priority]} 기준으로 호환 결과/데이터 상태/갱신 시점/실제 페이지 연결이 확인된 부품을 먼저 정렬했습니다.`
        : `${RECOMMENDATION_PRIORITY_LABELS[priority]} 기준으로 예산/부품 성능 점수를 정렬했습니다.`,
      ...(performanceTier ? [GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB[performanceTier] > 0 || GENERATOR_PERFORMANCE_TIER_CPU_MIN_SCORE[performanceTier] > 0
        ? `${RECOMMENDATION_PERFORMANCE_TIER_LABELS[performanceTier]} 목표에 맞춰 GPU VRAM ${GENERATOR_PERFORMANCE_TIER_GPU_MIN_VRAM_GB[performanceTier]}GB 이상/CPU 상위 성능 점수 기준으로 후보를 먼저 좁힌 뒤 예산/호환성을 적용했습니다.`
        : `${RECOMMENDATION_PERFORMANCE_TIER_LABELS[performanceTier]} 목표에 맞춰 예산 안에서 성능 점수가 높은 부품을 우선 정렬했습니다.`] : []),
      request.includeGpu ? "외장 그래픽카드를 포함한 구성입니다." : "CPU 내장 그래픽을 사용하는 구성입니다.",
      phase1Gaming
        ? "RAM은 고른 용량에 맞추고, 쿨러/케이스/파워는 부품의 발열/크기/전력에 맞춰 골랐어요."
        : request.includeGpu && profile === "gaming"
        ? `${GAMING_RESOLUTION_LABELS[gamingResolution]} / ${GAMING_REFRESH_RATE_LABELS[gamingRefreshRate]} 기준으로 권장 VRAM ${gamingAdvisoryTuning?.targetVramGb ?? GAMING_RESOLUTION_VRAM_TARGETS[gamingResolution]}GB와 GPU/CPU 처리 스펙을 더 중요하게 반영했습니다.`
        : "게임 해상도 기준은 게이밍 프로필에서만 GPU 추천 가중치에 반영했습니다.",
      ...(gamingOptionRationale ? [gamingOptionRationale] : []),
      ...(phase1Gaming ? ["메인보드 제조사의 CPU 지원표와 전원부 사양을 확인했습니다. 구매 전에 BIOS 버전도 확인해 주세요."] : []),
      "선택한 부품을 함께 사용할 수 있는지 확인했습니다.",
      phase1Gaming
        ? `RAM ${memoryCapacityGb.toLocaleString("ko-KR")}GB 이상과 ${storageCapacityGb.toLocaleString("ko-KR")}GB 이상 SSD 1개를 구성했습니다.`
        : `RAM ${memoryCapacityGb.toLocaleString("ko-KR")}GB 이상을 충족하는 2개 구성과 ${storageCapacityGb.toLocaleString("ko-KR")}GB 이상 SSD 1개를 기본으로 구성했습니다.`,
      hddCount > 0
        ? `${hddCapacityGb.toLocaleString("ko-KR")}GB 이상 HDD ${hddCount}개를 포함하고 메인보드 SATA 포트와 케이스 베이를 함께 확인했습니다.`
        : "HDD는 선택하지 않았습니다.",
      `${LISTING_POLICY_LABELS[listingPolicy]} 조건으로 부품을 제한했습니다.${listingPolicy === "retail_only" ? " 중고/해외구매/벌크 상품은 기본적으로 제외했습니다." : " 상품별 유통 조건을 구매 전에 확인해 주세요."}`
    ],
    warnings
  };
}

// 빔 탐색 없이 후보 풀 안에서 만들 수 있는 가장 저렴한 호환 조합의 총액을 구한다.
// 목표별 예산 안내와 실패 시 "예산을 얼마나 올려야 하는지" 복구 제안이 같은
// 실측 하한을 공유하도록, 풀 구성/호환 게이트/우선 후보 필터를 생성기와 동일하게 적용한다.
// 풀은 가격 오름차순으로 정렬해 두고 "첫 호환 후보 = 그 차원의 최솟값"으로 찾는다 —
// (cpu × 보드 × 쿨러 × GPU × 케이스) 전수 열거는 카탈로그가 커지면 수 초가 된다.
export function minimumFeasibleBuildPriceFor(catalog: Part[], request: BuildGenerationRequest, options: EngineGenerationOptions = {}): number | undefined {
  ({ catalog, request, options } = phase1GenerationInputs(catalog, request, options));
  const phase1Gaming = request.profile === "gaming" && options.gamingTestbedPhase1 === true;
  const context = generatorSearchContextFor(catalog, request, engineNowMilliseconds(options.now), options.targetFilters, phase1Gaming);
  if (context.missingPools.length > 0) return undefined;
  const {
    profile,
    memoryCapacityGb,
    storageCapacityGb,
    hddCount,
    hddCapacityGb,
    cpuPool,
    motherboardPool,
    memoryPool,
    coolerPool,
    casePool,
    ssdPool,
    hddPool,
    psuPool,
    gpuVendorPreference,
    gpuPool
  } = context;
  const pricedParts = (parts: Part[]) => parts.filter((part): part is Part & { priceWon: number } => isKnownPrice(part.priceWon));
  const byPrice = (left: { priceWon: number }, right: { priceWon: number }) => left.priceWon - right.priceWon;
  const kitQuantity = (part: Part) => memoryKitQuantityFor(part, memoryCapacityGb);
  const memorySorted = pricedParts(memoryPool.parts).sort((a, b) => a.priceWon * kitQuantity(a) - b.priceWon * kitQuantity(b));
  const ssdSorted = pricedParts(ssdPool.parts).sort(byPrice);
  const hddSorted = pricedParts(hddPool?.parts ?? []).sort(byPrice);
  const caseSorted = pricedParts(casePool.parts).sort(byPrice);
  const psuSorted = pricedParts(psuPool.parts).sort(byPrice);
  const coolerSorted = pricedParts(coolerPool.parts).sort(byPrice);
  const cpuSorted = pricedParts(cpuPool.parts).filter((part) => request.includeGpu || cpuHasIntegratedGraphics(part) === true).sort(byPrice);
  const motherboardSorted = pricedParts(motherboardPool.parts).sort(byPrice);

  const gpuCandidatesUnsorted = gpuPool === undefined
    ? []
    : (() => {
        const vendorMatched = gpuVendorPreference ? preferGpuVendor(gpuPool.parts, gpuVendorPreference) : gpuPool.parts;
        const vramMatched = profile === "creator" || profile === "development" ? preferMinGpuVram(vendorMatched, 12) : vendorMatched;
        return preferBudgetCandidates(vramMatched, Number.MAX_SAFE_INTEGER, 0.6);
      })();
  const gpuSorted = pricedParts(gpuCandidatesUnsorted).sort(byPrice);

  // 차원별 낙관적 하한 — 호환 무시하고 풀 최저가만 합산한 값. 이 값으로도
  // 현재 최선을 못 이기는 조합은 실제 호환 검사 없이 건너뛴다.
  const minAnyMemory = memorySorted.length > 0 ? memorySorted[0].priceWon * kitQuantity(memorySorted[0]) : 0;
  const minAnyStorage = (ssdSorted[0]?.priceWon ?? 0) + (hddCount > 0 ? (hddSorted[0]?.priceWon ?? 0) * hddCount : 0);
  const minAnyCase = caseSorted[0]?.priceWon ?? 0;
  const minAnyPsu = psuSorted[0]?.priceWon ?? 0;
  const minAnyGpu = gpuPool === undefined ? 0 : (gpuSorted[0]?.priceWon ?? 0);
  const optimisticTail = minAnyMemory + minAnyStorage + minAnyCase + minAnyPsu + minAnyGpu;

  const psuStateFor = (cpu: Part | undefined, gpu: Part | undefined): GeneratorState => ({
    selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: gpu === undefined },
    parts: { ...(cpu ? { cpu } : {}), ...(gpu ? { gpu } : {}) },
    priceWon: 0,
    capabilityScore: 0,
    rankingPriority: "balanced",
    ...(phase1Gaming ? { phase1Gaming: true } : {})
  });
  const psuCostCache = new Map<string, number>();
  // 가격 오름차순 파워에서 처음으로 "GPU 커넥터 + 적정 용량"을 통과하는 것 = 최저가.
  const minPsuCostFor = (cpu: Part | undefined, gpu: Part | undefined) => {
    const key = `${cpu?.id ?? ""}|${gpu?.id ?? ""}`;
    const cached = psuCostCache.get(key);
    if (cached !== undefined) return cached;
    const ceilingW = (() => {
      const needW = estimateSystemPowerW(psuStateFor(cpu, gpu));
      return Math.max(needW * 1.6, needW + 300, 650);
    })();
    let firstAdequate = Number.POSITIVE_INFINITY;
    let firstAny = Number.POSITIVE_INFINITY;
    for (const psu of psuSorted) {
      if (!generatorPsuCanUseGpu(psu, gpu)) continue;
      if (phase1Gaming && (psu.specs.wattageW ?? 0) < estimateSystemPowerW(psuStateFor(cpu, gpu))) continue;
      if (!Number.isFinite(firstAny)) firstAny = psu.priceWon;
      if ((psu.specs.wattageW ?? Number.MAX_SAFE_INTEGER) <= ceilingW) { firstAdequate = psu.priceWon; break; }
    }
    const cost = Number.isFinite(firstAdequate) ? firstAdequate : firstAny;
    psuCostCache.set(key, cost);
    return cost;
  };

  // 메모리 최저가: 생성기와 같은 호환+우선 체인을 거친 뒤 가장 싼 것.
  const memoryCostCache = new Map<string, number>();
  const minMemoryCostFor = (cpu: Part, motherboard: Part) => {
    const key = `${cpu.id}|${motherboard.id}`;
    const cached = memoryCostCache.get(key);
    if (cached !== undefined) return cached;
    const compatible = memoryPool.parts.filter((part) => generatorMemoryCanUseMotherboard(part, motherboard, cpu, memoryCapacityGb, engineTargetFilterNamesPart(part, options.targetFilters)));
    const candidates = phase1Gaming
      ? cheapestGeneratorCandidates(compatible, kitQuantity)
      : preferBudgetCandidates(
          preferMatchingMemoryProfile(preferDualChannelMemory(preferUsableMemorySpeed(compatible, motherboard, cpu, options.targetFilters), memoryCapacityGb), cpu),
          Number.MAX_SAFE_INTEGER,
          0.16,
          kitQuantity
        );
    let cost = Number.POSITIVE_INFINITY;
    for (const part of candidates) {
      if (!isKnownPrice(part.priceWon)) continue;
      const total = part.priceWon * kitQuantity(part);
      if (total < cost) cost = total;
    }
    memoryCostCache.set(key, cost);
    return cost;
  };

  // 저장장치 최저가: 보드만 바뀌어도 같은 결과라 보드별로 캐시한다.
  // HDD 최저가는 SSD가 SATA 포트를 잡아먹는지에만 달려 인터페이스별로 캐시한다.
  const hddCostCache = new Map<string, number>();
  const minHddCostFor = (motherboard: Part, ssd: Part) => {
    const key = `${motherboard.id}|${ssd.specs.interface ?? ""}`;
    const cached = hddCostCache.get(key);
    if (cached !== undefined) return cached;
    const candidates = preferRequestedCapacity(
      hddSorted.filter((part) => (part.specs.capacityGb ?? 0) >= hddCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, ssd, hddCount)),
      hddCapacityGb
    );
    const cost = candidates[0] !== undefined && isKnownPrice(candidates[0].priceWon) ? candidates[0].priceWon : Number.POSITIVE_INFINITY;
    hddCostCache.set(key, cost);
    return cost;
  };
  const storageCostCache = new Map<string, number>();
  const minStorageCostFor = (motherboard: Part) => {
    const key = motherboard.id;
    const cached = storageCostCache.get(key);
    if (cached !== undefined) return cached;
    let cost = Number.POSITIVE_INFINITY;
    const ssdCandidates = preferBudgetCandidates(
      preferRequestedCapacity(
        ssdSorted.filter((part) => (part.specs.capacityGb ?? 0) >= storageCapacityGb && generatorStorageCanUseMotherboard(part, motherboard, undefined, hddCount, phase1Gaming)),
        storageCapacityGb
      ),
      Number.MAX_SAFE_INTEGER,
      0.15
    );
    for (const ssd of ssdCandidates) {
      if (!isKnownPrice(ssd.priceWon)) continue;
      let hddCost = 0;
      if (hddCount > 0 && hddPool !== undefined) {
        const minHdd = minHddCostFor(motherboard, ssd);
        if (!Number.isFinite(minHdd)) continue;
        hddCost = minHdd * hddCount;
      }
      const total = ssd.priceWon + hddCost;
      if (total < cost) cost = total;
      const cheapestSsdPrice = ssdCandidates[0] !== undefined && isKnownPrice(ssdCandidates[0].priceWon) ? ssdCandidates[0].priceWon : Number.POSITIVE_INFINITY;
      if (total <= cheapestSsdPrice) break;
    }
    storageCostCache.set(key, cost);
    return cost;
  };

  // 쿨러 옵션 목록은 CPU만으로 결정된다 — cpuId로 캐시.
  const coolerOptionsCache = new Map<string, ((Part & { priceWon: number }) | undefined)[]>();
  const coolerOptionsFor = (cpu: Part) => {
    const cached = coolerOptionsCache.get(cpu.id);
    if (cached !== undefined) return cached;
    const stockCoolerAvailable = cpu.specs.coolerIncluded === true && (cpu.specs.pptW ?? cpu.specs.tdpW ?? 999) <= 100;
    const candidates = preferBudgetCandidates(
      preferCoolerHeadroom(coolerSorted.filter((part) => generatorCoolerCanUseCpu(part, cpu, phase1Gaming)), cpu, profile),
      Number.MAX_SAFE_INTEGER,
      0.1
    ).filter((part): part is Part & { priceWon: number } => isKnownPrice(part.priceWon));
    const options: ((Part & { priceWon: number }) | undefined)[] = stockCoolerAvailable ? [undefined, ...candidates] : candidates;
    coolerOptionsCache.set(cpu.id, options);
    return options;
  };

  // 보드+드라이브 개수만으로 호환되는 케이스 목록 — 쿨러/GPU 차원은 이후 필터.
  const caseByMbCache = new Map<string, Part[]>();
  const mbCompatibleCasesFor = (motherboard: Part) => {
    const cached = caseByMbCache.get(motherboard.id);
    if (cached !== undefined) return cached;
    const compatible = caseSorted.filter((part) =>
      motherboard.specs.formFactor !== undefined
      && part.specs.motherboardFormFactors?.includes(motherboard.specs.formFactor) === true
      && (hddCount === 0 || (part.specs.hddBays ?? 0) >= hddCount)
      && (!phase1Gaming || phase1CaseSupportsMotherboard(part, motherboard))
    );
    caseByMbCache.set(motherboard.id, compatible);
    return compatible;
  };

  let best = Number.POSITIVE_INFINITY;
  for (const cpu of cpuSorted) {
    if (cpu.priceWon + optimisticTail >= best) break;
    for (const motherboard of motherboardSorted) {
      if (cpu.priceWon + motherboard.priceWon + optimisticTail >= best) break;
      if (!generatorCpuCanUseMotherboard(cpu, motherboard, phase1Gaming)) continue;
      const minMemoryCost = minMemoryCostFor(cpu, motherboard);
      if (!Number.isFinite(minMemoryCost)) continue;
      const coolerOptions = coolerOptionsFor(cpu);
      if (coolerOptions.length === 0) continue;
      const minStorageCost = minStorageCostFor(motherboard);
      if (!Number.isFinite(minStorageCost)) continue;
      const baseCost = cpu.priceWon + motherboard.priceWon + minMemoryCost + minStorageCost;
      if (baseCost + optimisticTail - minAnyMemory - minAnyStorage >= best) continue;
      const mbCompatibleCases = mbCompatibleCasesFor(motherboard);
      for (const cooler of coolerOptions) {
        const coolerCost = cooler === undefined ? 0 : cooler.priceWon;
        if (baseCost + coolerCost + minAnyCase + minAnyPsu + minAnyGpu >= best) break;
        if (baseCost + coolerCost >= best) continue;
        const coolerCompatible = phase1Gaming
          ? mbCompatibleCases.filter((part) => generatorCaseCanUseParts(part, motherboard, cooler, undefined, hddCount, true))
          : cooler === undefined ? mbCompatibleCases : mbCompatibleCases.filter((part) => cooler.specs.maxCoolerHeightMm !== undefined && part.specs.maxCoolerHeightMm !== undefined && cooler.specs.maxCoolerHeightMm <= part.specs.maxCoolerHeightMm);
        if (gpuSorted.length === 0) {
          const caseCost = coolerCompatible[0]?.priceWon ?? Number.POSITIVE_INFINITY;
          const psuCost = minPsuCostFor(cpu, undefined);
          if (Number.isFinite(caseCost) && Number.isFinite(psuCost)) best = Math.min(best, baseCost + coolerCost + caseCost + psuCost);
        } else {
          for (const gpu of gpuSorted) {
            if (phase1Gaming && !request.pinnedParts?.cpu && !phase1CpuMeetsReference(cpu, gpu, request)) continue;
            if (baseCost + coolerCost + gpu.priceWon + minAnyCase + minAnyPsu >= best) break;
            const cooled = preferCooledCase(
              coolerCompatible.filter((part) => gpu.specs.lengthMm !== undefined && part.specs.maxGpuLengthMm !== undefined && gpu.specs.lengthMm <= part.specs.maxGpuLengthMm),
              gpu
            );
            const caseCost = cooled[0]?.priceWon ?? Number.POSITIVE_INFINITY;
            const psuCost = minPsuCostFor(cpu, gpu);
            if (Number.isFinite(caseCost) && Number.isFinite(psuCost)) best = Math.min(best, baseCost + coolerCost + gpu.priceWon + caseCost + psuCost);
          }
        }
      }
    }
  }
  return Number.isFinite(best) ? best : undefined;
}

// 온보딩의 목표별 가격대가 "실제로 만들 수 있는 최저 견적" 아래를 약속하지
// 않도록, 카탈로그 기준 최저 합계를 메타에 함께보낸다. 최저가를 재는
// probe 요청의 budgetWon은 풀 구성에 영향이 없으므로 임의의 유효 정수면 된다.
export function recommendationFloorWonFor(catalog: Part[], options: EngineGenerationOptions = {}): { integrated?: number; discreteGpu?: number; gaming?: Partial<Record<GamingResolution, number>> } {
  const probe = (overrides: Partial<BuildGenerationRequest>) => minimumFeasibleBuildPriceFor(catalog, {
    profile: "general",
    budgetWon: 10_000_000,
    includeGpu: true,
    memoryCapacityGb: 16,
    storageCapacityGb: 500,
    hddCount: 0,
    listingPolicy: "retail_only",
    ...overrides
  }, options);
  return {
    integrated: probe({ includeGpu: false }),
    discreteGpu: probe({}),
    gaming: {
      "1080p": probe({ profile: "gaming", gamingResolution: "1080p", gamingRefreshRate: 60 }),
      "1440p": probe({ profile: "gaming", gamingResolution: "1440p", gamingRefreshRate: 60 }),
      "4k": probe({ profile: "gaming", gamingResolution: "4k", gamingRefreshRate: 60 })
    }
  };
}

export function buildGenerationRecoveryOptionsFor(catalog: Part[], request: BuildGenerationRequest, options: EngineGenerationOptions = {}): BuildGenerationRecoveryOption[] {
  const targetMode = request.gamingMode === "target_fps";
  const domesticTestbed = request.gamingMode !== undefined || request.gamingTestbedPhase1 === true || options.gamingTestbedPhase1 === true;
  const candidates: Array<Pick<BuildGenerationRecoveryOption, "id" | "label" | "summary" | "changedFields"> & { request: BuildGenerationRequest }> = [];
  const addCandidate = (candidate: typeof candidates[number]) => {
    if (domesticTestbed && candidate.request.listingPolicy === "all") return;
    if (targetMode && candidate.request.gamingMode === "target_fps" && !candidate.request.includeGpu) return;
    if (JSON.stringify(candidate.request) === JSON.stringify(request)) return;
    if (candidates.some((existing) => JSON.stringify(existing.request) === JSON.stringify(candidate.request))) return;
    candidates.push(candidate);
  };
  const safeMinimumPriceFor = (candidate: BuildGenerationRequest): number | undefined => {
    try { return minimumFeasibleBuildPriceFor(catalog,candidate,options); } catch { return undefined; }
  };
  const minimumFeasiblePrice = safeMinimumPriceFor(request);
  if (domesticTestbed && request.profile === "gaming" && request.gamingResolution === "4k" && minimumFeasiblePrice !== undefined && minimumFeasiblePrice > request.budgetWon) {
    const viableBudget = Math.min(100_000_000,Math.ceil(minimumFeasiblePrice*1.05/10_000)*10_000);
    const viableRequest = { ...request,includeGpu:true,budgetWon:viableBudget };
    const resolutionCandidates: typeof candidates = [
      {id:"resolution-edit-budget",label:"예산 늘리기",summary:`4K 추천 기준의 현재 최소 구성은 약 ${minimumFeasiblePrice.toLocaleString("ko-KR")}원입니다. 예산 입력을 조정해 주세요.`,changedFields:[`목표 예산: ${viableBudget.toLocaleString("ko-KR")}원`],request:viableRequest},
      {id:"resolution-fit-budget",label:`현재 ${request.budgetWon.toLocaleString("ko-KR")}원에 맞추기`,summary:"현재 예산과 게임 목록을 유지하고 FHD 게임 견적으로 구성합니다.",changedFields:["해상도: FHD","게임 견적 기준: 예산"],request:{...request,includeGpu:true,gamingMode:"budget",gamingResolution:"1080p",gamingTargetFps:undefined}},
      {id:"resolution-recommended",label:"4K 추천 견적 만들기",summary:`4K GPU 체급/VRAM/CPU 기준을 유지하고 ${viableBudget.toLocaleString("ko-KR")}원 예산으로 구성합니다. 게임별 성능 보장과는 별도입니다.`,changedFields:[`목표 예산: ${viableBudget.toLocaleString("ko-KR")}원`],request:viableRequest}
    ];
    return resolutionCandidates.flatMap(candidate=>{
      try {
        const draft=generateBuildDraft(catalog,candidate.request,[],options);
        if (!draft.withinBudget || !draft.priceComplete || draft.status==="incompatible" || draft.blockerCount>0) return [];
        return [{...candidate,preview:{totalPriceWon:draft.totalPriceWon,budgetDeltaWon:draft.budgetDeltaWon,withinBudget:draft.withinBudget,priceComplete:draft.priceComplete,status:draft.status,blockerCount:draft.blockerCount,warningCount:draft.warningCount,unknownCount:draft.unknownCount}}];
      } catch { return []; }
    });
  }
  if (request.listingPolicy === "retail_only" || (request.listingPolicy === undefined && !request.includeNonRetail)) {
    addCandidate({
      id: "include-bulk",
      label: "벌크 포함으로 다시 찾기",
      summary: "신품/정식 유통만 제한하지 않고 벌크 상품까지 부품에 포함합니다.",
      changedFields: ["구매 조건: 벌크 포함"],
      request: { ...request, listingPolicy: "include_bulk", includeNonRetail: false }
    });
    addCandidate({
      id: "include-all-listings",
      label: "전체 유통 조건으로 다시 찾기",
      summary: "벌크/병행수입/해외구매/중고까지 포함해 호환 조합을 다시 탐색합니다.",
      changedFields: ["구매 조건: 전체 조건"],
      request: { ...request, listingPolicy: "all", includeNonRetail: true }
    });
  }
  if (request.includeGpu) {
    addCandidate({
      id: "without-discrete-gpu",
      label: "외장 그래픽카드 제외",
      summary: "CPU 내장 그래픽을 사용하는 사무/일반형 조합으로 다시 탐색합니다.",
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
      summary: `RAM 목표 용량을 ${lowerMemoryCapacity}GB로 낮춰 호환 부품을 다시 탐색합니다.`,
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
      summary: `기본 SSD 목표 용량을 ${lowerStorageCapacity.toLocaleString("ko-KR")}GB로 낮춰 호환 부품을 다시 탐색합니다.`,
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
  // 항목을 하나만 낮춰도 예산에 못 미치는 요청에는 여러 조건을 함께 낮춘
  // 조합을 제안한다 — 개별 완화만으로는 탈출구가 없는 실패를 막기 위해서다.
  const minimalChanges: string[] = [];
  if (request.includeGpu) minimalChanges.push("외장 그래픽카드 제외");
  if ((request.memoryCapacityGb ?? 32) > 16) minimalChanges.push("RAM 목표: 16GB");
  if ((request.storageCapacityGb ?? 1000) > 500) minimalChanges.push("SSD 목표: 500GB");
  if ((request.hddCount ?? 0) > 0) minimalChanges.push("HDD 제외");
  if (minimalChanges.length > 1) {
    addCandidate({
      id: "minimal-combination",
      label: "최소 조건 조합으로 다시 찾기",
      summary: "여러 조건을 함께 낮춰 현재 예산 안에 들어갈 수 있는 구성을 탐색합니다.",
      changedFields: minimalChanges,
      request: {
        ...request,
        ...(request.includeGpu ? { includeGpu: false } : {}),
        memoryCapacityGb: Math.min(request.memoryCapacityGb ?? 32, 16),
        storageCapacityGb: Math.min(request.storageCapacityGb ?? 1000, 500),
        hddCount: 0
      }
    });
    if ((request.listingPolicy === "retail_only" || (request.listingPolicy === undefined && !request.includeNonRetail))) {
      addCandidate({
        id: "minimal-combination-all-listings",
        label: "최소 조건 + 전체 유통 조건으로 다시 찾기",
        summary: "조건을 함께 낮추고 벌크/병행수입/해외구매/중고까지 포함해 다시 탐색합니다.",
        changedFields: [...minimalChanges, "구매 조건: 전체 조건"],
        request: {
          ...request,
          listingPolicy: "all",
          includeNonRetail: true,
          ...(request.includeGpu ? { includeGpu: false } : {}),
          memoryCapacityGb: Math.min(request.memoryCapacityGb ?? 32, 16),
          storageCapacityGb: Math.min(request.storageCapacityGb ?? 1000, 500),
          hddCount: 0
        }
      });
    }
  }
  if (targetMode) {
    addCandidate({ id: "gaming-budget-mode", label: "예산에 맞는 게임 견적으로 전환", summary: "FPS 목표를 내려놓고 같은 예산에서 GPU 성능을 우선해 다시 찾습니다.", changedFields: ["게임 견적 기준: 예산"], request: { ...request, gamingMode: "budget", gamingTargetFps: undefined, gamingGameIds: [], gamingGraphicsPreset: undefined, gamingRayTracing: undefined, gamingUpscaling: undefined } });
    const lowerFps = [30, 60, 100, 144, 240].filter((value) => value < (request.gamingTargetFps ?? 60)).at(-1);
    if (lowerFps) addCandidate({ id: "lower-target-fps", label: `${lowerFps} FPS로 비교`, summary: "같은 게임/옵션에서 낮은 FPS 목표로 부품을 다시 비교합니다.", changedFields: [`목표 FPS: ${lowerFps}`], request: { ...request, gamingTargetFps: lowerFps } });
    if (request.gamingResolution === "4k") addCandidate({ id: "qhd-target", label: "QHD로 비교", summary: "같은 게임의 해상도를 QHD로 낮춰 비교합니다.", changedFields: ["해상도: QHD"], request: { ...request, gamingResolution: "1440p" } });
  }
  if (minimumFeasiblePrice !== undefined && minimumFeasiblePrice > request.budgetWon) {
    const viableBudget = Math.min(100_000_000, Math.ceil(minimumFeasiblePrice * 1.05 / 10_000) * 10_000);
    if (viableBudget > request.budgetWon) {
      addCandidate({
        id: "budget-minimum-viable",
        label: `최소 구성 가능 예산으로 다시 찾기`,
        summary: `현재 조건의 가장 저렴한 호환 조합이 약 ${minimumFeasiblePrice.toLocaleString("ko-KR")}원입니다. 예산을 ${viableBudget.toLocaleString("ko-KR")}원으로 올려 다시 탐색합니다.`,
        changedFields: [`목표 예산: ${viableBudget.toLocaleString("ko-KR")}원`],
        request: { ...request, budgetWon: viableBudget }
      });
    }
  }
  if (request.budgetWon < 100_000_000) {
    const expandedBudget = Math.min(100_000_000, Math.ceil(request.budgetWon * 1.2 / 10_000) * 10_000);
    if (expandedBudget > request.budgetWon) {
      addCandidate({
        id: "budget-plus-20",
        label: "예산을 20% 늘려 다시 찾기",
        summary: `목표 예산을 ${expandedBudget.toLocaleString("ko-KR")}원으로 늘려 부품 조합을 탐색합니다.`,
        changedFields: [`목표 예산: ${expandedBudget.toLocaleString("ko-KR")}원`],
        request: { ...request, budgetWon: expandedBudget }
      });
    }
  }
  return candidates.flatMap((candidate) => {
    try {
      const draft = generateBuildDraft(catalog, candidate.request, [], options);
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
