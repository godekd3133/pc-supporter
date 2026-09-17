import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiBox, FiCheck, FiChevronDown, FiCopy, FiCpu, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiHardDrive, FiInfo, FiLayers, FiLoader, FiMessageSquare, FiMonitor, FiSave, FiShare2, FiTool, FiTrash2, FiUpload, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildAnalysis, BuildGenerationDiagnostic, BuildGenerationRecoveryOption, BuildGenerationRequest, BuildGenerationResult, BuildGenerationVariantResult, BuildSelection, GamingGraphicsPreset, GamingPerformanceAssessment, GamingRefreshRate, GamingResolution, GamingUpscaling, PartCategory, RecommendationPerformanceTier, RecommendationPriority, RecommendationProfile, ListingPolicy } from "../shared/types";
import { budgetLadderBaseRequestFor, budgetLadderChangeFor, budgetLadderCsvFor, budgetLadderExportPayloadFor, budgetLadderJsonFor, budgetLadderTextFor } from "../shared/budget-ladder";
import type { BudgetLadderOutcome } from "../shared/budget-ladder";
import { budgetLadderTradeoffFor } from "../shared/budget-ladder-tradeoff";
import type { BudgetLadderShareSnapshot } from "../shared/budget-ladder-share";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";
import { GENERATOR_VARIANTS_LOCAL_HISTORY_KEY, generatorVariantsLocalHistoryFromJson, generatorVariantsLocalHistoryRemember, generatorVariantsLocalHistoryRemove, generatorVariantsLocalHistoryToJson } from "../shared/generator-variants-local-history";
import type { GeneratorVariantsLocalHistoryEntry } from "../shared/generator-variants-local-history";
import { GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY, generatorVariantsLocalShareExpired, generatorVariantsLocalShareRemember, generatorVariantsLocalShareRemove, generatorVariantsLocalSharesFromJson, generatorVariantsLocalSharesToJson } from "../shared/generator-variants-local-share";
import type { GeneratorVariantsLocalShareEntry } from "../shared/generator-variants-local-share";
import { GENERATOR_VARIANTS_EXPORT_TYPE, GENERATOR_VARIANTS_EXPORT_VERSION } from "../shared/generator-variants-share";
import type { GeneratorVariantsExportPayload, GeneratorVariantsShareSnapshot } from "../shared/generator-variants-share";
import { BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_M2_SLOTS, BUILD_INPUT_MAX_SELECTIONS_PER_LIST } from "../shared/build-input-limits";
import { addSavedGeneratorPreset, generatorPresetConfigFromUnknown, GENERATOR_PRESET_STORAGE_KEY, mergeSavedGeneratorPresets, removeSavedGeneratorPreset, savedGeneratorPresetsFromJson, savedGeneratorPresetsToJson } from "../shared/generator-preset";
import type { GeneratorPresetConfig, SavedGeneratorPreset } from "../shared/generator-preset";
import { gamingPerformanceEvidenceRequestFor } from "../shared/gaming-performance-evidence";
import { CATEGORY_LABELS, GAMING_GRAPHICS_PRESET_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_UPSCALING_LABELS, isKnownPrice, isRecommendationPriority, LISTING_POLICY_LABELS, PART_CATEGORIES, RECOMMENDATION_PERFORMANCE_TIER_LABELS, RECOMMENDATION_PRIORITY_DESCRIPTIONS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { savedBuildComparisonDecisionFor } from "../shared/saved-build-comparison";
import type { SavedBuildComparisonDecisionKind, SavedBuildComparisonEntry } from "../shared/saved-build-comparison";
import { generatorBriefInterpretationFor } from "../shared/generator-brief";
import type { GeneratorBriefConfig, GeneratorBriefInterpretation } from "../shared/generator-brief";
import { api, ApiError } from "./api";
import { budgetEstimateFor, gameLabelFor, intensityOptionFor, ONBOARDING_WORKS, workEstimateFor } from "./quote-onboarding";
import type { OnboardingIntensity, OnboardingWork } from "./quote-onboarding";
import { safeHttpsUrl } from "./safe-source-url";

export type GeneratorVariantResult = BuildGenerationVariantResult;

export type GeneratorBudgetResult = BudgetLadderOutcome;

export type GeneratorBudgetShareResult = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
  catalogSnapshotAt?: string;
};

type GeneratorBudgetShareResponse = BudgetLadderShareSnapshot & {
  ownerToken: string;
};

const CATEGORY_ICONS: Record<PartCategory, IconType> = {
  cpu: FiCpu,
  cooler: FiTool,
  motherboard: FiCpu,
  memory: FiDatabase,
  gpu: FiMonitor,
  ssd: FiHardDrive,
  hdd: FiHardDrive,
  case: FiBox,
  psu: FiZap
};

function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

function gamingEvidenceStatusLabel(status: GamingPerformanceAssessment["status"]) {
  return status === "verified" ? "평균 FPS 기준 충족" : status === "target_not_met" ? "목표 FPS 미달" : status === "partial" ? "일부 조건 확인" : status === "stale" ? "자료 갱신 필요" : status === "missing" ? "근거 없음" : "확인 필요";
}

function gamingEvidenceAdminUrlFor(assessment: GamingPerformanceAssessment) {
  if (typeof window === "undefined" || !["localhost", "127.0.0.1"].includes(window.location.hostname)) return undefined;
  const url = new URL("/admin", window.location.origin);
  url.searchParams.set("reviewEvidence", "gaming");
  if (assessment.gameIds.length === 1) url.searchParams.set("gamingGame", assessment.gameIds[0]!);
  if (assessment.gpuPartId) url.searchParams.set("gamingGpu", assessment.gpuPartId);
  url.searchParams.set("gamingResolution", assessment.resolution);
  url.searchParams.set("gamingRefresh", String(assessment.refreshRate));
  if (assessment.graphicsPreset) url.searchParams.set("gamingGraphics", assessment.graphicsPreset);
  if (assessment.upscaling) url.searchParams.set("gamingUpscaling", assessment.upscaling);
  if (assessment.rayTracing !== undefined) url.searchParams.set("gamingRt", assessment.rayTracing ? "true" : "false");
  url.hash = "admin-gaming-performance-evidence";
  return `${url.pathname}${url.search}${url.hash}`;
}

function GeneratorGamingEvidence({ assessment, gpuTarget, onToast }: { assessment: GamingPerformanceAssessment; gpuTarget?: BuildGenerationResult["gpuTarget"]; onToast?: (message: string) => void }) {
  const gameLabels = assessment.gameIds.map(gameLabelFor);
  const matchedGameIds = assessment.matchedGameIds ?? [];
  const missingGameIds = assessment.missingGameIds ?? assessment.gameIds.filter((gameId) => !matchedGameIds.includes(gameId));
  const belowTargetGameIds = assessment.belowTargetGameIds ?? [];
  const staleRecordCount = assessment.staleRecordIds?.length ?? 0;
  const coverageMessage = missingGameIds.length > 0
    ? `자료가 없는 게임 · ${missingGameIds.map(gameLabelFor).join(" · ")}`
    : belowTargetGameIds.length > 0
      ? `목표 FPS 미달 · ${belowTargetGameIds.map(gameLabelFor).join(" · ")}`
      : staleRecordCount > 0
        ? `갱신이 필요한 측정 자료 ${staleRecordCount}개`
        : "선택한 모든 게임에 exact-condition 자료가 연결되었습니다.";
  const coverageTone = missingGameIds.length > 0 || belowTargetGameIds.length > 0 || staleRecordCount > 0 ? "review" : "complete";
  const adminEvidenceUrl = gamingEvidenceAdminUrlFor(assessment);
  const evidenceRequest = gamingPerformanceEvidenceRequestFor(assessment);
  const [requestCopied, setRequestCopied] = useState(false);
  async function copyEvidenceRequest() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(evidenceRequest, null, 2));
      setRequestCopied(true);
      window.setTimeout(() => setRequestCopied(false), 2_400);
      onToast?.("exact-condition FPS 측정 요청 JSON을 복사했습니다.");
    } catch {
      onToast?.("측정 요청 JSON을 복사하지 못했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }
  const measuredState = assessment.status === "verified" ? "complete" : assessment.status === "partial" || assessment.status === "target_not_met" ? "review" : "pending";
  const measuredLabel = assessment.status === "verified" ? "평균 기준 충족" : assessment.status === "partial" ? "일부 확인" : assessment.status === "target_not_met" ? "목표 미달" : assessment.status === "stale" ? "갱신 필요" : "미연결";
  const gpuState = gpuTarget?.currentFit === "met" ? "complete" : gpuTarget?.currentFit === "partial" ? "review" : "pending";
  const gpuLabel = gpuTarget?.currentFit === "met" ? "참고 기준 충족" : gpuTarget?.currentFit === "partial" ? "추가 확인" : "확인 필요";
  return <section className={`generator-gaming-evidence status-${assessment.status}`} data-testid="generator-gaming-evidence">
    <div className="generator-gaming-evidence-heading"><div><p className="eyebrow">GAME PERFORMANCE EVIDENCE</p><strong>게임별 FPS 근거</strong></div><span>{gamingEvidenceStatusLabel(assessment.status)}</span></div>
    <div className="generator-gaming-target-tags" aria-label="게이밍 목표 조건">
      {gameLabels.length > 0 ? gameLabels.map((label, index) => <span className="generator-gaming-target-tag" key={`${assessment.gameIds[index]}-${label}`}>{label}</span>) : <span className="generator-gaming-target-tag muted">일반 게이밍 기준</span>}
      <span className="generator-gaming-target-tag">{GAMING_RESOLUTION_LABELS[assessment.resolution]} · {assessment.refreshRate} FPS</span>
      {assessment.graphicsPreset && <span className="generator-gaming-target-tag">{GAMING_GRAPHICS_PRESET_LABELS[assessment.graphicsPreset]}</span>}
      {assessment.upscaling && <span className="generator-gaming-target-tag">{GAMING_UPSCALING_LABELS[assessment.upscaling]}</span>}
      {assessment.rayTracing && <span className="generator-gaming-target-tag">레이 트레이싱</span>}
    </div>
    {gameLabels.length > 0 && <div className={`generator-gaming-coverage ${coverageTone}`} data-testid="generator-gaming-coverage" aria-label="게임별 근거 coverage"><div><strong>EXACT-CONDITION COVERAGE</strong><span>{matchedGameIds.length} / {gameLabels.length}개 게임 자료 연결</span></div><p>{coverageMessage}</p><small>{assessment.gpuName ? `선택 GPU · ${assessment.gpuName}` : "선택 GPU 확인 필요"} · 게임·해상도·FPS·그래픽 조건이 모두 일치하는 자료만 연결합니다.</small><div className="generator-gaming-coverage-actions">{adminEvidenceUrl && <a className="generator-gaming-coverage-link" href={adminEvidenceUrl}><FiExternalLink /> 운영 coverage로 확인</a>}<button className="generator-gaming-coverage-copy" type="button" data-testid="generator-gaming-evidence-request-copy" onClick={() => void copyEvidenceRequest()}><FiCopy /> {requestCopied ? "복사됨" : "측정 요청 JSON 복사"}</button></div></div>}
    <div className="generator-gaming-checklist" aria-label="성능 확인 단계">
      <div className="generator-gaming-check complete"><FiCheck /><div><strong>선택 조건 보존</strong><small>게임·해상도·목표 FPS·그래픽 조건을 자동 구성에 전달했습니다.</small></div><span>완료</span></div>
      <div className={`generator-gaming-check ${gpuState}`}><FiCheck /><div><strong>카탈로그 GPU 기준</strong><small>{gpuTarget?.summary ?? "GPU 참고 기준을 계산하지 못했습니다."}</small></div><span>{gpuLabel}</span></div>
      <div className={`generator-gaming-check ${measuredState}`}><FiAlertTriangle /><div><strong>게임별 실측 FPS</strong><small>{assessment.status === "target_not_met" ? "연결된 측정값 중 목표 프레임보다 낮은 조건이 있습니다." : assessment.status === "verified" ? "선택 GPU와 조건이 일치하고 평균 FPS가 목표 프레임 이상인 자료입니다." : "게임 옵션·드라이버·측정일이 포함된 실측 자료가 연결되어야 합니다."}</small></div><span>{measuredLabel}</span></div>
      <div className="generator-gaming-check pending"><FiInfo /><div><strong>실제 환경 확인</strong><small>모니터·드라이버·온도·전력·게임 패치까지 구매 전에 확인합니다.</small></div><span>구매 전</span></div>
    </div>
    {assessment.measurements && assessment.measurements.length > 0 && <div className="generator-gaming-measurements" aria-label="연결된 실측 FPS"><div className="generator-gaming-measurements-heading"><strong>연결된 실측 결과</strong><span>평균 FPS 기준 · GPU {assessment.gpuName ?? "확인된 모델"}</span></div><div className="generator-gaming-measurement-list">{assessment.measurements.map((measurement) => { const sourceUrl = safeHttpsUrl(measurement.sourceUrl); const meetsTarget = measurement.averageFps >= assessment.refreshRate; return <article className={`generator-gaming-measurement ${meetsTarget ? "meets" : "below"}`} key={measurement.recordId}><div className="generator-gaming-measurement-top"><div><strong>{gameLabelFor(measurement.gameId)}</strong><small>{measurement.gpuName}</small></div><div><strong>{measurement.averageFps.toLocaleString("ko-KR")} FPS</strong><span>목표 {assessment.refreshRate} FPS</span></div></div><div className="generator-gaming-measurement-meta"><span>{measurement.onePercentLowFps !== undefined ? `1% low ${measurement.onePercentLowFps.toLocaleString("ko-KR")} FPS` : "1% low 미기록"}</span><span>측정 {new Date(measurement.measuredAt).toLocaleDateString("ko-KR")}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">출처 <FiShare2 /></a>}</div></article>; })}</div></div>}
    <p>{assessment.note}</p>
    <small>{gameLabels.length > 0 ? `${gameLabels.length}개 게임 조건을 보존했습니다.` : "특정 게임을 선택하지 않은 일반 게이밍 조건입니다."} 평균 FPS 자료가 있어도 측정 환경이 달라질 수 있으므로 절대적인 FPS 보장으로 해석하지 않습니다.</small>
  </section>;
}

function CategoryIcon({ category }: { category: PartCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon />;
}

function GeneratorWorkContext({ workType, intensity, draft }: { workType?: OnboardingWork; intensity?: OnboardingIntensity; draft: BuildGenerationResult }) {
  if (!workType || !intensity) return null;
  const work = ONBOARDING_WORKS.find((option) => option.id === workType);
  if (!work) return null;
  const estimate = workEstimateFor([workType], intensity);
  const intensityLabel = intensityOptionFor(intensity).label;
  return <section className="generator-work-context" data-testid="generator-work-context" aria-label="작업 기준 설명">
    <div className="generator-work-context-heading"><div><p className="eyebrow">WORK TARGET</p><strong>{work.label} · {intensityLabel}</strong></div><span>구성 기준</span></div>
    <div className="generator-work-context-tags"><span>{estimate.performance}</span><span>{estimate.gpu}</span><span>{estimate.memory}</span><span>{estimate.storage}</span></div>
    <p>이 기준을 바탕으로 작업에 필요한 그래픽 처리 여유·메모리·저장공간을 우선 반영했습니다. 현재 목표 예산 {formatWon(draft.budgetWon)} 안에서 아래 실제 부품을 예산·호환성·현재 카탈로그 상태와 함께 계산했습니다.</p>
    <small>작업 기준은 참고 사양이며 렌더 시간·빌드 시간·플러그인 처리 성능을 절대적으로 보장하지 않습니다.</small>
  </section>;
}

function GeneratorGeneralContext({ performanceTier, includeGpu, draft }: { performanceTier?: RecommendationPerformanceTier; includeGpu: boolean; draft: BuildGenerationResult }) {
  const directSpec = Boolean(draft.performanceTier ?? performanceTier);
  const budgetEstimate = budgetEstimateFor(draft.budgetWon, undefined);
  const estimate = directSpec
    ? { performance: RECOMMENDATION_PERFORMANCE_TIER_LABELS[draft.performanceTier ?? performanceTier ?? "high"], gpu: includeGpu ? "외장 GPU 포함" : "내장 그래픽", memory: `${draft.memoryCapacityGb}GB`, storage: draft.storageCapacityGb >= 1000 ? `${draft.storageCapacityGb / 1000}TB SSD` : `${draft.storageCapacityGb}GB SSD` }
    : budgetEstimate;
  return <section className="generator-work-context generator-general-context" data-testid="generator-general-context" aria-label="일반 견적 기준 설명">
    <div className="generator-work-context-heading"><div><p className="eyebrow">GENERAL TARGET</p><strong>{directSpec ? `${estimate.performance} · 직접 입력` : "예산 중심 구성"}</strong></div><span>구성 기준</span></div>
    <div className="generator-work-context-tags"><span>{estimate.performance}</span><span>{estimate.gpu}</span><span>{estimate.memory}</span><span>{estimate.storage}</span></div>
    <p>{directSpec ? "온보딩에서 입력한 성능 등급·외장 GPU·메모리·저장공간 조건을 유지한 채 아래 실제 부품을 예산·호환성·현재 카탈로그 상태와 함께 계산했습니다." : "온보딩에서 선택한 예산을 기준으로 현재 카탈로그에서 예상되는 구성 수준을 먼저 보여주고, 아래 실제 부품을 예산·호환성·가격 확인 상태와 함께 계산했습니다."}</p>
    <small>이 카드는 입력 기준과 실제 선택 부품을 구분하기 위한 참고 정보이며, 모든 작업 성능을 절대적으로 보장하지 않습니다.</small>
  </section>;
}

function initialGeneratorParam(name: string) {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

function initialGeneratorProfile(fallback: RecommendationProfile) {
  const value = initialGeneratorParam("profile");
  return value === "gaming" || value === "creator" || value === "development" || value === "office" || value === "general" ? value : fallback;
}

function initialGeneratorPriority() {
  const value = initialGeneratorParam("priority");
  return value === "budget" || value === "performance" || value === "balanced" ? value : "balanced" as const;
}

function initialGeneratorPerformanceTier(): RecommendationPerformanceTier | undefined {
  const value = initialGeneratorParam("tier");
  return value === "entry" || value === "high" || value === "top" ? value : undefined;
}

function initialGeneratorResolution() {
  const value = initialGeneratorParam("resolution");
  return value === "1080p" || value === "4k" || value === "1440p" ? value : "1440p" as const;
}

function initialGeneratorRefreshRate() {
  const value = Number(initialGeneratorParam("refresh"));
  return value === 60 || value === 240 || value === 144 ? value as GamingRefreshRate : 144;
}

function initialGeneratorGameIds() {
  const value = initialGeneratorParam("games");
  return value ? value.split(",").map((item) => item.trim()).filter((item) => item.length > 0).slice(0, 5) : [];
}

function initialGeneratorGraphicsPreset(): GamingGraphicsPreset {
  const value = initialGeneratorParam("graphics");
  return value === "competitive" || value === "high" ? value : "balanced";
}

function initialGeneratorRayTracing() {
  return initialGeneratorParam("rt") === "1";
}

function initialGeneratorUpscaling(): GamingUpscaling {
  const value = initialGeneratorParam("upscaling");
  return value === "native" || value === "balanced" ? value : "quality";
}

function initialGeneratorWorkType(): OnboardingWork | undefined {
  const value = initialGeneratorParam("work");
  return ONBOARDING_WORKS.some((work) => work.id === value) ? value as OnboardingWork : undefined;
}

function initialGeneratorWorkIntensity(): OnboardingIntensity | undefined {
  const value = initialGeneratorParam("intensity");
  return value === "light" || value === "balanced" || value === "heavy" ? value : undefined;
}

function initialGeneratorChoice(name: string, allowed: readonly string[], fallback: string) {
  const value = initialGeneratorParam(name);
  return value && allowed.includes(value) ? value : fallback;
}

function initialGeneratorBudget() {
  const value = Number(initialGeneratorParam("budget"));
  return Number.isInteger(value) && value > 0 && value <= 1_000_000_000 ? String(value) : "1500000";
}

function initialGeneratorIncludeGpu() {
  return initialGeneratorParam("gpu") !== "0";
}

function initialGeneratorAutorun() {
  return initialGeneratorParam("autorun") === "1";
}

type GeneratorPreset = GeneratorPresetConfig & {
  id: string;
  label: string;
  summary: string;
};

const GENERATOR_PRESETS: GeneratorPreset[] = [
  { id: "office", label: "사무·일반", summary: "내장 그래픽 · 16GB · 80만원", profile: "office", priority: "budget", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 16, budgetWon: 800_000, includeGpu: false, storageCapacityGb: 500, hddCount: 0, hddCapacityGb: 4_000, listingPolicy: "retail_only" },
  { id: "fhd-gaming", label: "FHD 게이밍", summary: "1080p · 144Hz · 150만원", profile: "gaming", priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: 1_500_000, includeGpu: true, storageCapacityGb: 1_000, hddCount: 0, hddCapacityGb: 4_000, listingPolicy: "retail_only" },
  { id: "qhd-gaming", label: "QHD 게이밍", summary: "1440p · 144Hz · 220만원", profile: "gaming", priority: "performance", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: 2_200_000, includeGpu: true, storageCapacityGb: 1_000, hddCount: 0, hddCapacityGb: 4_000, listingPolicy: "retail_only" },
  { id: "4k-gaming", label: "4K 게이밍", summary: "4K · 60Hz · 350만원", profile: "gaming", priority: "performance", gamingResolution: "4k", gamingRefreshRate: 60, memoryCapacityGb: 64, budgetWon: 3_500_000, includeGpu: true, storageCapacityGb: 2_000, hddCount: 0, hddCapacityGb: 4_000, listingPolicy: "retail_only" },
  { id: "development-ai", label: "개발·AI", summary: "64GB · GPU 포함 · 250만원", profile: "development", priority: "balanced", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 64, budgetWon: 2_500_000, includeGpu: true, storageCapacityGb: 2_000, hddCount: 0, hddCapacityGb: 4_000, listingPolicy: "retail_only" }
];

export function BuildGeneratorView({ initialProfile, draft, variants, budgetLadder, requestError, diagnostics = [], recoveryOptions = [], loading, onGenerate, onGenerateVariants, onGenerateBudgetLadder, onApply, onSave, onToast, onBudgetLadderShareSaved, onBudgetLadderShareRevoked, onBack }: { initialProfile: RecommendationProfile; draft: BuildGenerationResult | null; variants: GeneratorVariantResult[]; budgetLadder: GeneratorBudgetResult[]; requestError?: string | null; diagnostics?: BuildGenerationDiagnostic[]; recoveryOptions?: BuildGenerationRecoveryOption[]; loading: boolean; onGenerate: (request: BuildGenerationRequest) => Promise<void>; onGenerateVariants: (request: BuildGenerationRequest) => Promise<void>; onGenerateBudgetLadder: (request: BuildGenerationRequest) => Promise<void>; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void; onToast: (message: string) => void; onBudgetLadderShareSaved: (share: BudgetLadderLocalShareEntry) => void; onBudgetLadderShareRevoked: (id: string) => void; onBack: () => void }) {
  const [profile, setProfile] = useState<RecommendationProfile>(() => initialGeneratorProfile(initialProfile));
  const [priority, setPriority] = useState<RecommendationPriority>(initialGeneratorPriority);
  const [performanceTier, setPerformanceTier] = useState<RecommendationPerformanceTier | undefined>(initialGeneratorPerformanceTier);
  const [gamingResolution, setGamingResolution] = useState<GamingResolution>(initialGeneratorResolution);
  const [gamingRefreshRate, setGamingRefreshRate] = useState<GamingRefreshRate>(initialGeneratorRefreshRate);
  const [gamingGameIds, setGamingGameIds] = useState<string[]>(initialGeneratorGameIds);
  const [gamingGraphicsPreset, setGamingGraphicsPreset] = useState<GamingGraphicsPreset>(initialGeneratorGraphicsPreset);
  const [gamingRayTracing, setGamingRayTracing] = useState(initialGeneratorRayTracing);
  const [gamingUpscaling, setGamingUpscaling] = useState<GamingUpscaling>(initialGeneratorUpscaling);
  const [workType, setWorkType] = useState<OnboardingWork | undefined>(initialGeneratorWorkType);
  const [workIntensity, setWorkIntensity] = useState<OnboardingIntensity | undefined>(initialGeneratorWorkIntensity);
  const [memoryCapacityGb, setMemoryCapacityGb] = useState(() => initialGeneratorChoice("ram", ["16", "32", "64", "128"], "32"));
  const [budget, setBudget] = useState(initialGeneratorBudget);
  const [includeGpu, setIncludeGpu] = useState(initialGeneratorIncludeGpu);
  const [storageCapacityGb, setStorageCapacityGb] = useState(() => initialGeneratorChoice("ssd", ["500", "1000", "2000", "4000"], "1000"));
  const [hddCount, setHddCount] = useState(() => initialGeneratorChoice("hdd", ["0", "1", "2", "4"], "0"));
  const [hddCapacityGb, setHddCapacityGb] = useState(() => initialGeneratorChoice("hddCapacity", ["2000", "4000", "8000", "16000"], "4000"));
  const [listingPolicy, setListingPolicy] = useState<ListingPolicy>(() => initialGeneratorChoice("listingPolicy", ["retail_only", "include_bulk", "all"], "retail_only") as ListingPolicy);
  const [error, setError] = useState<string | null>(null);
  const [budgetLadderShare, setBudgetLadderShare] = useState<GeneratorBudgetShareResult | null>(null);
  const [savedPresets, setSavedPresets] = useState<SavedGeneratorPreset[]>(() => typeof window === "undefined" ? [] : savedGeneratorPresetsFromJson(window.localStorage.getItem(GENERATOR_PRESET_STORAGE_KEY)));
  const [presetName, setPresetName] = useState("");
  const [presetImportPreview, setPresetImportPreview] = useState<SavedGeneratorPreset[] | null>(null);
  const [brief, setBrief] = useState("");
  const [briefInterpretation, setBriefInterpretation] = useState<GeneratorBriefInterpretation | null>(null);
  const [briefApplied, setBriefApplied] = useState(false);
  const presetImportInputRef = useRef<HTMLInputElement | null>(null);
  const budgetLadderShareMutationRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== GENERATOR_PRESET_STORAGE_KEY) return;
      setSavedPresets(savedGeneratorPresetsFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const initialProfileRef = useRef(initialProfile);
  const previousGeneratorBudgetRef = useRef<string | null>(null);
  const previousGeneratorUrlRef = useRef<string | null>(null);
  const restoreGeneratorUrlRef = useRef(false);
  const generatorBudgetHistoryActiveRef = useRef(false);
  const generatorBudgetHistoryTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (initialProfileRef.current === initialProfile) return;
    initialProfileRef.current = initialProfile;
    setProfile(initialProfile);
  }, [initialProfile]);
  useEffect(() => {
    budgetLadderShareMutationRequestRef.current += 1;
    if (budgetLadder.length === 0) setBudgetLadderShare(null);
  }, [budgetLadder]);
  useEffect(() => () => { budgetLadderShareMutationRequestRef.current += 1; }, []);
  useEffect(() => {
    try {
      if (savedPresets.length > 0) window.localStorage.setItem(GENERATOR_PRESET_STORAGE_KEY, savedGeneratorPresetsToJson(savedPresets));
      else window.localStorage.removeItem(GENERATOR_PRESET_STORAGE_KEY);
    } catch {
      // A full local storage bucket must not prevent automatic configuration from working.
    }
  }, [savedPresets]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/recommend")) return;
    const params = new URLSearchParams();
    params.set("profile", profile);
    if (priority !== "balanced") params.set("priority", priority);
    if (profile === "general" && performanceTier) params.set("tier", performanceTier);
    if (profile === "gaming") {
      // Keep an onboarding handoff's explicit target stable after the generator mounts.
      // Omitting 144 FPS or the selected default graphics rule here silently changes a
      // shareable requirement URL back into an implicit generator default.
      params.set("resolution", gamingResolution);
      params.set("refresh", String(gamingRefreshRate));
      if (gamingGameIds.length > 0) params.set("games", gamingGameIds.join(","));
      params.set("graphics", gamingGraphicsPreset);
      if (gamingRayTracing) params.set("rt", "1");
      params.set("upscaling", gamingUpscaling);
    }
    if (workType && workIntensity) {
      params.set("work", workType);
      params.set("intensity", workIntensity);
    }
    if (memoryCapacityGb !== "32") params.set("ram", memoryCapacityGb);
    if (budget !== "1500000") params.set("budget", budget);
    if (!includeGpu) params.set("gpu", "0");
    if (storageCapacityGb !== "1000") params.set("ssd", storageCapacityGb);
    if (hddCount !== "0") params.set("hdd", hddCount);
    if (hddCount !== "0" && hddCapacityGb !== "4000") params.set("hddCapacity", hddCapacityGb);
    if (listingPolicy !== "retail_only") params.set("listingPolicy", listingPolicy);
    const nextSearch = params.toString();
    const nextUrl = `/recommend${nextSearch ? `?${nextSearch}` : ""}`;
    const currentUrl = window.location.pathname + window.location.search;
    const budgetChanged = previousGeneratorBudgetRef.current !== null && previousGeneratorBudgetRef.current !== budget;
    const clearBudgetHistoryTimer = () => {
      if (generatorBudgetHistoryTimerRef.current !== null) {
        window.clearTimeout(generatorBudgetHistoryTimerRef.current);
        generatorBudgetHistoryTimerRef.current = null;
      }
    };
    if (restoreGeneratorUrlRef.current) {
      clearBudgetHistoryTimer();
      generatorBudgetHistoryActiveRef.current = false;
      restoreGeneratorUrlRef.current = false;
      if (currentUrl !== nextUrl) window.history.replaceState(window.history.state, "", nextUrl);
    } else if (budgetChanged) {
      if (currentUrl !== nextUrl) {
        if (generatorBudgetHistoryActiveRef.current) window.history.replaceState(window.history.state, "", nextUrl);
        else if (previousGeneratorUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
        else window.history.pushState(window.history.state, "", nextUrl);
      }
      previousGeneratorUrlRef.current = nextUrl;
      generatorBudgetHistoryActiveRef.current = true;
      clearBudgetHistoryTimer();
      generatorBudgetHistoryTimerRef.current = window.setTimeout(() => {
        generatorBudgetHistoryActiveRef.current = false;
        generatorBudgetHistoryTimerRef.current = null;
      }, 800);
    } else {
      clearBudgetHistoryTimer();
      generatorBudgetHistoryActiveRef.current = false;
      if (currentUrl !== nextUrl) {
        if (previousGeneratorUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
        else window.history.pushState(window.history.state, "", nextUrl);
      }
    }
    previousGeneratorUrlRef.current = nextUrl;
    previousGeneratorBudgetRef.current = budget;
  }, [budget, gamingGameIds, gamingGraphicsPreset, gamingRayTracing, gamingRefreshRate, gamingResolution, gamingUpscaling, hddCapacityGb, hddCount, includeGpu, initialProfile, listingPolicy, memoryCapacityGb, performanceTier, priority, profile, storageCapacityGb, workIntensity, workType]);

  useEffect(() => {
    const onPopState = () => {
      if (!window.location.pathname.startsWith("/recommend")) return;
      restoreGeneratorUrlRef.current = true;
      setProfile(initialGeneratorProfile(initialProfile));
      setPriority(initialGeneratorPriority());
      setPerformanceTier(initialGeneratorPerformanceTier());
      setGamingResolution(initialGeneratorResolution());
      setGamingRefreshRate(initialGeneratorRefreshRate());
      setGamingGameIds(initialGeneratorGameIds());
      setGamingGraphicsPreset(initialGeneratorGraphicsPreset());
      setGamingRayTracing(initialGeneratorRayTracing());
      setGamingUpscaling(initialGeneratorUpscaling());
      setWorkType(initialGeneratorWorkType());
      setWorkIntensity(initialGeneratorWorkIntensity());
      setMemoryCapacityGb(initialGeneratorChoice("ram", ["16", "32", "64", "128"], "32"));
      setBudget(initialGeneratorBudget());
      setIncludeGpu(initialGeneratorIncludeGpu());
      setStorageCapacityGb(initialGeneratorChoice("ssd", ["500", "1000", "2000", "4000"], "1000"));
      setHddCount(initialGeneratorChoice("hdd", ["0", "1", "2", "4"], "0"));
      setHddCapacityGb(initialGeneratorChoice("hddCapacity", ["2000", "4000", "8000", "16000"], "4000"));
      setListingPolicy(initialGeneratorChoice("listingPolicy", ["retail_only", "include_bulk", "all"], "retail_only") as ListingPolicy);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialProfile]);

  const autorunRequestedRef = useRef(initialGeneratorAutorun());
  const autorunHandledRef = useRef(false);
  useEffect(() => {
    if (!autorunRequestedRef.current || autorunHandledRef.current) return;
    autorunHandledRef.current = true;
    void generateFromForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentGeneratorPresetConfig(): GeneratorPresetConfig | null {
    return generatorPresetConfigFromUnknown({
      profile,
      priority,
      performanceTier,
      gamingResolution,
      gamingRefreshRate,
      gamingGameIds,
      gamingGraphicsPreset,
      gamingRayTracing,
      gamingUpscaling,
      memoryCapacityGb: Number(memoryCapacityGb),
      budgetWon: Number(budget),
      includeGpu,
      storageCapacityGb: Number(storageCapacityGb),
      hddCount: Number(hddCount),
      hddCapacityGb: Number(hddCapacityGb),
      listingPolicy
    });
  }

  function applyGeneratorPresetConfig(config: GeneratorPresetConfig, label: string) {
    setProfile(config.profile);
    setPriority(config.priority);
    setWorkType(undefined);
    setWorkIntensity(undefined);
    setPerformanceTier(config.performanceTier);
    setGamingResolution(config.gamingResolution);
    setGamingRefreshRate(config.gamingRefreshRate);
    setGamingGameIds(config.gamingGameIds ?? []);
    setGamingGraphicsPreset(config.gamingGraphicsPreset ?? "balanced");
    setGamingRayTracing(config.gamingRayTracing ?? false);
    setGamingUpscaling(config.gamingUpscaling ?? "quality");
    setMemoryCapacityGb(String(config.memoryCapacityGb));
    setBudget(String(config.budgetWon));
    setIncludeGpu(config.includeGpu);
    setStorageCapacityGb(String(config.storageCapacityGb));
    setHddCount(String(config.hddCount));
    setHddCapacityGb(String(config.hddCapacityGb));
    setListingPolicy(config.listingPolicy);
    setError(null);
    onToast(`${label} 조건을 불러왔습니다. 생성 전에 조건을 확인해 주세요.`);
  }

  function applyPreset(preset: GeneratorPreset) {
    applyGeneratorPresetConfig(preset, preset.label);
  }

  function interpretBrief() {
    setBriefInterpretation(generatorBriefInterpretationFor(brief));
    setBriefApplied(false);
  }

  function appendBriefPhrase(phrase: string) {
    const nextBrief = brief.trim() ? `${brief.trim()}, ${phrase}` : phrase;
    setBrief(nextBrief);
    setBriefInterpretation(generatorBriefInterpretationFor(nextBrief));
    setBriefApplied(false);
    onToast(`${phrase} 조건을 추가해 다시 해석했습니다. 아직 폼에는 적용하지 않았습니다.`);
  }

  function applyBriefConfig(config: GeneratorBriefConfig, matchCount: number) {
    setWorkType(undefined);
    setWorkIntensity(undefined);
    if (config.profile !== undefined) setProfile(config.profile);
    if (config.priority !== undefined) setPriority(config.priority);
    if (config.gamingResolution !== undefined) setGamingResolution(config.gamingResolution);
    if (config.gamingRefreshRate !== undefined) setGamingRefreshRate(config.gamingRefreshRate);
    if (config.memoryCapacityGb !== undefined) setMemoryCapacityGb(String(config.memoryCapacityGb));
    if (config.budgetWon !== undefined) setBudget(String(config.budgetWon));
    if (config.includeGpu !== undefined) setIncludeGpu(config.includeGpu);
    if (config.storageCapacityGb !== undefined) setStorageCapacityGb(String(config.storageCapacityGb));
    if (config.hddCount !== undefined) setHddCount(String(config.hddCount));
    if (config.hddCapacityGb !== undefined) setHddCapacityGb(String(config.hddCapacityGb));
    if (config.listingPolicy !== undefined) setListingPolicy(config.listingPolicy);
    setError(null);
    setBriefApplied(true);
    onToast(`${matchCount}개 조건을 폼에 적용했습니다. 생성 전에 적용된 값을 확인해 주세요.`);
  }

  function clearBrief() {
    setBrief("");
    setBriefInterpretation(null);
    setBriefApplied(false);
  }

  function saveCurrentPreset() {
    const name = presetName.trim().slice(0, 60);
    const config = currentGeneratorPresetConfig();
    if (!name) {
      onToast("저장할 프리셋 이름을 입력해 주세요.");
      return;
    }
    if (!config) {
      onToast("예산과 구성 조건을 확인한 뒤 프리셋을 저장해 주세요.");
      return;
    }
    const now = new Date().toISOString();
    const preset: SavedGeneratorPreset = { ...config, id: `generator-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, createdAt: now, updatedAt: now };
    setSavedPresets((current) => addSavedGeneratorPreset(current, preset));
    setPresetName("");
    onToast(`${name} 프리셋을 저장했습니다.`);
  }

  function exportSavedPresets() {
    if (savedPresets.length === 0) {
      onToast("저장된 내 프리셋이 없습니다.");
      return;
    }
    const blob = new Blob([savedGeneratorPresetsToJson(savedPresets)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-generator-presets-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${savedPresets.length}개 내 프리셋을 JSON으로 저장했습니다.`);
  }

  async function importSavedPresets(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      onToast("프리셋 JSON은 1MB 이하 파일만 가져올 수 있습니다.");
      return;
    }
    const imported = savedGeneratorPresetsFromJson(await file.text());
    if (!mountedRef.current) return;
    if (imported.length === 0) {
      onToast("가져올 수 있는 유효한 프리셋이 없습니다.");
      return;
    }
    setPresetImportPreview(imported);
    onToast(`${imported.length}개 내 프리셋을 가져왔습니다. 병합 전 내용을 확인해 주세요.`);
  }

  function confirmImportSavedPresets() {
    if (!presetImportPreview) return;
    const importedCount = presetImportPreview.length;
    setSavedPresets((current) => mergeSavedGeneratorPresets(current, presetImportPreview));
    setPresetImportPreview(null);
    onToast(`${importedCount}개 내 프리셋을 기존 목록과 병합했습니다.`);
  }

  function cancelImportSavedPresets() {
    setPresetImportPreview(null);
    onToast("내 프리셋 가져오기를 취소했습니다.");
  }

  function removeSavedPreset(preset: SavedGeneratorPreset) {
    setSavedPresets((current) => removeSavedGeneratorPreset(current, preset.id));
    onToast(`${preset.name} 프리셋을 삭제했습니다.`);
  }

  function requestFromForm(): BuildGenerationRequest | undefined {
    const budgetWon = Number(budget);
    const requestedMemoryCapacityGb = Number(memoryCapacityGb);
    const requestedStorageCapacityGb = Number(storageCapacityGb);
    const requestedHddCount = Number(hddCount);
    const requestedHddCapacityGb = Number(hddCapacityGb);
    if (!Number.isInteger(budgetWon) || budgetWon <= 0) {
      setError("목표 예산은 1원 이상의 정수로 입력해 주세요.");
      return undefined;
    }
    if (![16, 32, 64, 128].includes(requestedMemoryCapacityGb)) {
      setError("RAM 목표 용량은 16GB, 32GB, 64GB, 128GB 중 하나를 선택해 주세요.");
      return undefined;
    }
    if (!Number.isInteger(requestedStorageCapacityGb) || requestedStorageCapacityGb <= 0 || !Number.isInteger(requestedHddCount) || requestedHddCount < 0 || requestedHddCount > 8 || !Number.isInteger(requestedHddCapacityGb) || requestedHddCapacityGb <= 0) {
      setError("저장장치 용량과 HDD 개수를 확인해 주세요.");
      return undefined;
    }
    setError(null);
    return { profile, priority, performanceTier: profile === "general" ? performanceTier : undefined, budgetWon, includeGpu, gamingResolution, gamingRefreshRate, gamingGameIds, gamingGraphicsPreset, gamingRayTracing, gamingUpscaling, memoryCapacityGb: requestedMemoryCapacityGb, storageCapacityGb: requestedStorageCapacityGb, hddCapacityGb: requestedHddCapacityGb, hddCount: requestedHddCount, listingPolicy };
  }

  async function generateFromForm() {
    const request = requestFromForm();
    if (request) await onGenerate(request);
  }

  async function generateVariantsFromForm() {
    const request = requestFromForm();
    if (request) await onGenerateVariants(request);
  }

  async function generateBudgetLadderFromForm() {
    const request = requestFromForm();
    if (request) await onGenerateBudgetLadder(request);
  }

  async function copyBudgetLadder() {
    try {
      await navigator.clipboard.writeText(budgetLadderTextFor(budgetLadder));
      if (mountedRef.current) onToast("예산 구간 비교표를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("예산 구간 비교표 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  async function copyGeneratorVariants(targetVariants: GeneratorVariantResult[]) {
    try {
      await navigator.clipboard.writeText(generatorVariantsTextFor(targetVariants));
      if (mountedRef.current) onToast("자동 구성 비교 결과를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("자동 구성 비교 결과 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  async function copyGeneratorConditionsLink() {
    const url = window.location.origin + window.location.pathname + window.location.search;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(url);
      if (mountedRef.current) onToast("자동 구성 조건 링크를 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("자동 구성 조건 링크: " + url);
    }
  }

  function downloadBudgetLadder(format: "csv" | "json") {
    const content = format === "csv" ? budgetLadderCsvFor(budgetLadder) : budgetLadderJsonFor(budgetLadder);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-budget-ladder-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`예산 구간 비교표 ${format.toUpperCase()}를 저장했습니다.`);
  }

  function downloadGeneratorVariants(targetVariants: GeneratorVariantResult[]) {
    const blob = new Blob([generatorVariantsJsonFor(targetVariants)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-generator-variants-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast("자동 구성 비교 결과 JSON을 저장했습니다.");
  }

  async function shareBudgetLadder() {
    if (budgetLadder.length === 0) {
      onToast("공유할 예산 구간 비교 결과가 없습니다.");
      return;
    }
    const requestVersion = ++budgetLadderShareMutationRequestRef.current;
    const isCurrent = () => mountedRef.current && budgetLadderShareMutationRequestRef.current === requestVersion;
    try {
      const request = budgetLadderBaseRequestFor(budgetLadder);
      const saved = await api<GeneratorBudgetShareResponse>("/api/budget-ladders", {
        method: "POST",
        body: JSON.stringify({
          name: "PC Supporter 예산 구간 비교",
          payload: budgetLadderExportPayloadFor(budgetLadder),
          ...(request ? { request } : {}),
          expiresInDays: 30
        }),
        retry: 0
      });
      if (!isCurrent()) return;
      const url = `${window.location.origin}/budget-ladder/${saved.id}`;
      try {
        await navigator.clipboard.writeText(url);
        if (!isCurrent()) return;
        onToast("예산 구간 비교 공유 링크를 클립보드에 복사했습니다.");
      } catch {
        if (!isCurrent()) return;
        onToast(`예산 구간 비교 링크가 생성되었습니다: ${url}`);
      }
      if (!isCurrent()) return;
      setBudgetLadderShare({ id: saved.id, url, ownerToken: saved.ownerToken, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), catalogSnapshotAt: saved.catalogSnapshotAt });
      onBudgetLadderShareSaved({ id: saved.id, url, name: saved.name, createdAt: saved.createdAt, ...(saved.versionNumber !== undefined ? { versionNumber: saved.versionNumber } : {}), ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ownerToken: saved.ownerToken });
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "예산 구간 비교 공유 링크를 만들지 못했습니다.");
    }
  }

  async function revokeBudgetLadder() {
    if (!budgetLadderShare || !window.confirm("이 예산 구간 비교 공유 링크를 취소할까요? 이미 전달된 링크도 더 이상 열리지 않습니다.")) return;
    const requestVersion = ++budgetLadderShareMutationRequestRef.current;
    const isCurrent = () => mountedRef.current && budgetLadderShareMutationRequestRef.current === requestVersion;
    const share = budgetLadderShare;
    try {
      await api(`/api/budget-ladders/${encodeURIComponent(share.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": share.ownerToken }, retry: 0 });
      if (!isCurrent()) return;
      setBudgetLadderShare(null);
      onBudgetLadderShareRevoked(share.id);
      onToast("예산 구간 비교 공유 링크를 취소했습니다.");
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "예산 구간 비교 공유 링크를 취소하지 못했습니다.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await generateFromForm();
  }

  async function applyRecoveryOption(option: BuildGenerationRecoveryOption) {
    const request = option.request;
    setProfile(request.profile);
    setPriority(request.priority ?? "balanced");
    setPerformanceTier(request.performanceTier);
    setGamingResolution(request.gamingResolution ?? "1440p");
    setGamingRefreshRate(request.gamingRefreshRate ?? 144);
    setGamingGameIds(request.gamingGameIds ?? []);
    setGamingGraphicsPreset(request.gamingGraphicsPreset ?? "balanced");
    setGamingRayTracing(request.gamingRayTracing ?? false);
    setGamingUpscaling(request.gamingUpscaling ?? "quality");
    setMemoryCapacityGb(String(request.memoryCapacityGb ?? 32));
    setBudget(String(request.budgetWon));
    setIncludeGpu(request.includeGpu);
    setStorageCapacityGb(String(request.storageCapacityGb ?? 1000));
    setHddCount(String(request.hddCount ?? 0));
    setHddCapacityGb(String(request.hddCapacityGb ?? 4000));
    setListingPolicy(request.listingPolicy ?? (request.includeNonRetail ? "all" : "retail_only"));
    await onGenerate(request);
  }

  const presetImportSummary = presetImportPreview ? (() => {
    const existingIds = new Set(savedPresets.map((preset) => preset.id));
    const replacementCount = presetImportPreview.filter((preset) => existingIds.has(preset.id)).length;
    return { importedCount: presetImportPreview.length, replacementCount, newCount: presetImportPreview.length - replacementCount };
  })() : null;
  const statusLabel = draft?.status === "compatible" ? "호환 가능한 초안" : draft?.status === "needs_review" ? "확인이 필요한 초안" : "검토가 필요한 초안";
  const intensity = workIntensity;
  const adjustGeneratorConditions = () => {
    document.querySelector<HTMLElement>(".generator-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return <div className="generator-page">
    <div className="workspace-heading"><div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">AUTO BUILD DRAFT</p><h1>조건으로 PC 견적 만들기</h1><p>사용 목적과 예산을 입력하면, 지금 확인할 수 있는 부품으로 맞는 조합을 찾아드려요.</p></div></div>
    <div className="generator-layout">
      <form className="generator-form" onSubmit={submit}>
        <div className="generator-form-heading"><span className="generator-form-icon"><FiZap /></span><div><p className="eyebrow">STARTING POINT</p><h2>원하는 구성 조건</h2></div><button className="text-button generator-condition-link-button" type="button" data-testid="generator-copy-condition-link" onClick={() => void copyGeneratorConditionsLink()}><FiCopy /> 조건 링크 복사</button></div>
        <section className="generator-brief" aria-label="한 줄 조건 분석" data-testid="generator-brief">
          <div className="generator-brief-heading"><div><span className="generator-brief-icon"><FiMessageSquare /></span><div><p className="eyebrow">BRIEF TO BUILD</p><h3>원하는 조건을 한 줄로 시작</h3></div></div><span>미리보기 후 적용</span></div>
          <label className="generator-brief-input"><span>원하는 PC를 자연어로 적어 주세요</span><textarea data-testid="generator-brief-input" rows={2} value={brief} onChange={(event) => { setBrief(event.target.value); setBriefInterpretation(null); setBriefApplied(false); }} placeholder="예: QHD 게이밍 220만원, RAM 32GB, SSD 2TB, 144Hz" disabled={loading} /></label>
          <div className="generator-brief-actions"><button className="button button-brief" type="button" data-testid="generator-interpret-brief" onClick={interpretBrief} disabled={loading || !brief.trim()}><FiMessageSquare /> 조건 분석</button><button className="button button-brief-ghost" type="button" onClick={clearBrief} disabled={loading || (!brief && !briefInterpretation)}>지우기</button></div>
          {briefInterpretation && <div className={`generator-brief-preview ${briefInterpretation.confidence}`} data-testid="generator-brief-preview" aria-live="polite"><div className="generator-brief-preview-heading"><div><strong>해석 미리보기</strong><small>{briefInterpretation.matches.length}개 조건 · 핵심 {briefInterpretation.coverage.matched}/{briefInterpretation.coverage.total} · {briefInterpretation.confidence === "high" ? "정보 충분" : briefInterpretation.confidence === "medium" ? "일부 조건 확인" : "확인 필요"}</small></div><span>{briefApplied ? "폼에 적용됨" : "아직 적용하지 않음"}</span></div>{briefInterpretation.matches.length > 0 ? <div className="generator-brief-matches">{briefInterpretation.matches.map((match) => <span key={match.field}><b>{match.label}</b><strong>{match.value}</strong></span>)}</div> : <p className="generator-brief-empty"><FiInfo /> 적용할 수 있는 조건을 찾지 못했습니다.</p>}{briefInterpretation.warnings.length > 0 && <ul className="generator-brief-warnings">{briefInterpretation.warnings.map((warning) => <li key={warning}><FiAlertTriangle /> {warning}</li>)}</ul>}{briefInterpretation.guidance.length > 0 && <div className="generator-brief-guidance" data-testid="generator-brief-guidance"><div className="generator-brief-guidance-heading"><strong>정확도를 더 높이려면</strong><small>{briefInterpretation.coverage.missing.slice(0, 3).join(" · ")}{briefInterpretation.coverage.missing.length > 3 ? " · 외 추가 조건" : ""}</small></div><div className="generator-brief-guidance-grid">{briefInterpretation.guidance.map((item) => item.phrase ? <button className="generator-brief-guidance-item actionable" type="button" key={item.id} data-testid={`generator-guidance-${item.id}`} onClick={() => appendBriefPhrase(item.phrase!)} disabled={loading}><strong>{item.label}</strong><small>{item.detail}</small><em>+ {item.phrase}</em></button> : <div className="generator-brief-guidance-item" key={item.id}><strong>{item.label}</strong><small>{item.detail}</small></div>)}</div></div>}<p className="generator-brief-note"><FiInfo /> 해석 가능한 값만 폼에 반영합니다. 해석 결과가 불완전하거나 충돌하면 현재 값은 유지되며, 자동 생성은 직접 눌러야 시작됩니다.</p><button className="button button-brief-apply" type="button" data-testid="generator-apply-brief" onClick={() => applyBriefConfig(briefInterpretation.config, briefInterpretation.matches.length)} disabled={loading || briefInterpretation.matches.length === 0 || briefApplied}>{briefApplied ? <><FiCheck /> 적용 완료 · 폼에서 확인</> : <><FiEdit3 /> 해석한 조건을 폼에 적용</>}</button></div>}
        </section>
        <section className="generator-presets" aria-label="자동 구성 빠른 시작"><div className="generator-presets-heading"><strong>빠른 시작</strong><span>조건만 채우고 생성 전 직접 수정할 수 있습니다.</span></div><div className="generator-preset-list">{GENERATOR_PRESETS.map((preset) => <button className="generator-preset" type="button" key={preset.id} data-testid={`generator-preset-${preset.id}`} onClick={() => applyPreset(preset)} disabled={loading}><strong>{preset.label}</strong><small>{preset.summary}</small></button>)}</div><p className="generator-presets-note"><FiInfo /> 프리셋은 추천 기본값일 뿐이며 실제 호환성·가격은 생성 후 현재 카탈로그 기준으로 다시 확인합니다.</p><div className="generator-saved-preset-editor"><label><span>내 프리셋 이름</span><input data-testid="generator-preset-name" type="text" maxLength={60} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="예: 회사 개발용 PC" disabled={loading} /></label><button className="button button-light" type="button" data-testid="generator-save-preset" onClick={saveCurrentPreset} disabled={loading || !presetName.trim()}><FiSave /> 현재 조건 저장</button></div><div className="generator-saved-preset-tools"><input ref={presetImportInputRef} className="generator-saved-preset-file" type="file" accept=".json,application/json" aria-label="내 자동 구성 프리셋 JSON 가져오기" onChange={(event) => { void importSavedPresets(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={loading} /><button className="button button-light" type="button" data-testid="generator-import-presets" onClick={() => presetImportInputRef.current?.click()} disabled={loading}><FiUpload /> JSON 가져오기</button><button className="button button-light" type="button" data-testid="generator-export-presets" onClick={exportSavedPresets} disabled={loading || savedPresets.length === 0}><FiDownload /> JSON 저장</button></div>{presetImportSummary && presetImportPreview && <section className="generator-preset-import-preview" data-testid="generator-preset-import-preview" aria-label="내 프리셋 가져오기 미리보기"><div><strong>가져올 프리셋 확인</strong><span>{presetImportSummary.importedCount}개 가져옴 · 신규 {presetImportSummary.newCount}개 · 기존 ID 대체 {presetImportSummary.replacementCount}개</span></div><ul>{presetImportPreview.slice(0, 6).map((preset) => <li key={preset.id}>{preset.name} · {RECOMMENDATION_PROFILE_LABELS[preset.profile]} · {preset.budgetWon.toLocaleString("ko-KR")}원</li>)}{presetImportPreview.length > 6 && <li>외 {presetImportPreview.length - 6}개</li>}</ul><p><FiInfo /> 확인하면 기존 목록과 병합하며 최대 10개만 보관합니다. 현재 목록의 오래된 항목은 밀려날 수 있습니다.</p><div><button className="button button-light" type="button" data-testid="generator-cancel-import-presets" onClick={cancelImportSavedPresets}>취소</button><button className="button button-primary" type="button" data-testid="generator-confirm-import-presets" onClick={confirmImportSavedPresets}>확인 후 병합</button></div></section>}{savedPresets.length > 0 && <div className="generator-saved-preset-list" aria-label="내 자동 구성 프리셋">{savedPresets.map((preset) => <article key={preset.id}><div><strong>{preset.name}</strong><small>{RECOMMENDATION_PROFILE_LABELS[preset.profile]} · {preset.budgetWon.toLocaleString("ko-KR")}원{preset.gamingGameIds?.length ? ` · 게임 ${preset.gamingGameIds.length}개` : ""} · 저장 {new Date(preset.updatedAt).toLocaleDateString("ko-KR")}</small></div><div><button className="text-button" type="button" data-testid={`generator-load-preset-${preset.id}`} onClick={() => applyGeneratorPresetConfig(preset, preset.name)} disabled={loading}><FiEdit3 /> 불러오기</button><button className="text-button danger-text-button" type="button" data-testid={`generator-delete-preset-${preset.id}`} onClick={() => removeSavedPreset(preset)} disabled={loading}><FiTrash2 /> 삭제</button></div></article>)}</div>}</section>
        <label><span>사용 목적</span><select value={profile} disabled={loading} onChange={(event) => setProfile(event.target.value as RecommendationProfile)}><option value="general">{RECOMMENDATION_PROFILE_LABELS.general}</option><option value="gaming">{RECOMMENDATION_PROFILE_LABELS.gaming}</option><option value="creator">{RECOMMENDATION_PROFILE_LABELS.creator}</option><option value="development">{RECOMMENDATION_PROFILE_LABELS.development}</option><option value="office">{RECOMMENDATION_PROFILE_LABELS.office}</option></select></label>
        <label><span>구성 우선순위</span><select data-testid="generator-priority" value={priority} disabled={loading} onChange={(event) => setPriority(event.target.value as RecommendationPriority)}><option value="balanced">{RECOMMENDATION_PRIORITY_LABELS.balanced}</option><option value="budget">{RECOMMENDATION_PRIORITY_LABELS.budget}</option><option value="performance">{RECOMMENDATION_PRIORITY_LABELS.performance}</option><option value="reliability">{RECOMMENDATION_PRIORITY_LABELS.reliability}</option></select></label>
        <p className="generator-note generator-priority-note" data-testid="generator-priority-note"><FiInfo /> <strong>{RECOMMENDATION_PRIORITY_LABELS[priority]}</strong> · {RECOMMENDATION_PRIORITY_DESCRIPTIONS[priority]}</p>
        <label><span>목표 예산</span><div className="generator-input-with-unit"><input type="number" inputMode="numeric" min="1" step="10000" value={budget} disabled={loading} onChange={(event) => setBudget(event.target.value)} placeholder="예: 1500000" /><em>원</em></div></label>
        <details className="generator-advanced-options" data-testid="generator-advanced-options">
          <summary><span>세부 조건 조정</span><small>해상도 · RAM · 저장장치 · 구매 조건</small><FiChevronDown /></summary>
          <div>
            {profile === "gaming" && <label><span>게임 해상도 <em>게이밍 추천 기준</em></span><select value={gamingResolution} disabled={loading} onChange={(event) => setGamingResolution(event.target.value as GamingResolution)}><option value="1080p">{GAMING_RESOLUTION_LABELS["1080p"]}</option><option value="1440p">{GAMING_RESOLUTION_LABELS["1440p"]}</option><option value="4k">{GAMING_RESOLUTION_LABELS["4k"]}</option></select></label>}
            {profile === "gaming" && <label><span>목표 주사율 <em>성능 우선 가중치</em></span><select value={gamingRefreshRate} disabled={loading} onChange={(event) => setGamingRefreshRate(Number(event.target.value) as GamingRefreshRate)}><option value="60">{GAMING_REFRESH_RATE_LABELS[60]}</option><option value="144">{GAMING_REFRESH_RATE_LABELS[144]}</option><option value="240">{GAMING_REFRESH_RATE_LABELS[240]}</option></select></label>}
            {profile === "general" && performanceTier && <label><span>직접 입력한 성능 등급 <em>온보딩 조건</em></span><select value={performanceTier} disabled={loading} onChange={(event) => setPerformanceTier(event.target.value as RecommendationPerformanceTier)}>{Object.entries(RECOMMENDATION_PERFORMANCE_TIER_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>}
            {profile === "gaming" && <div className="generator-gaming-advisory-options" data-testid="generator-gaming-advisory-options">
              <div className="generator-gaming-advisory-heading"><span>게임별 추가 조건</span><small>{gamingGameIds.length > 0 ? `${gamingGameIds.length}개 게임 조건 저장됨` : "게임을 선택하지 않은 일반 게이밍 기준"}</small></div>
              <div className="generator-gaming-game-list"><span>선택한 게임</span><div>{gamingGameIds.length > 0 ? gamingGameIds.map((id) => <span className="generator-gaming-game-chip" key={id}>{gameLabelFor(id)}</span>) : <small>특정 게임을 선택하지 않은 일반 기준</small>}</div></div>
              <label><span>그래픽 품질</span><select value={gamingGraphicsPreset} disabled={loading} onChange={(event) => setGamingGraphicsPreset(event.target.value as GamingGraphicsPreset)}>{Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
              <label><span>업스케일링</span><select value={gamingUpscaling} disabled={loading} onChange={(event) => setGamingUpscaling(event.target.value as GamingUpscaling)}>{Object.entries(GAMING_UPSCALING_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
              <label className="generator-checkbox"><input type="checkbox" checked={gamingRayTracing} disabled={loading} onChange={(event) => setGamingRayTracing(event.target.checked)} /><span><strong>레이 트레이싱 조건 포함</strong><small>게임별 FPS 실측이 없으면 참고 조건·확인 필요로 표시합니다.</small></span></label>
            </div>}
            <label><span>RAM 목표 용량</span><select value={memoryCapacityGb} disabled={loading} onChange={(event) => setMemoryCapacityGb(event.target.value)}><option value="16">16GB 이상</option><option value="32">32GB 이상</option><option value="64">64GB 이상</option><option value="128">128GB 이상</option></select></label>
            <label><span>기본 SSD 용량</span><select value={storageCapacityGb} disabled={loading} onChange={(event) => setStorageCapacityGb(event.target.value)}><option value="500">500GB 이상</option><option value="1000">1TB 이상</option><option value="2000">2TB 이상</option><option value="4000">4TB 이상</option></select></label>
            <div className="generator-storage-grid"><label><span>HDD 개수</span><select value={hddCount} disabled={loading} onChange={(event) => setHddCount(event.target.value)}><option value="0">사용하지 않음</option><option value="1">1개</option><option value="2">2개</option><option value="4">4개</option></select></label><label><span>HDD 용량</span><select value={hddCapacityGb} disabled={loading || hddCount === "0"} onChange={(event) => setHddCapacityGb(event.target.value)}><option value="2000">2TB 이상</option><option value="4000">4TB 이상</option><option value="8000">8TB 이상</option><option value="16000">16TB 이상</option></select></label></div>
            <label className="generator-checkbox"><input type="checkbox" checked={includeGpu} disabled={loading} onChange={(event) => setIncludeGpu(event.target.checked)} /><span><strong>외장 그래픽카드 포함</strong><small>끄면 CPU 내장 그래픽을 사용하는 초안을 찾습니다.</small></span></label>
            <label><span>구매 조건</span><select value={listingPolicy} disabled={loading} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}><option value="retail_only">{LISTING_POLICY_LABELS.retail_only}</option><option value="include_bulk">{LISTING_POLICY_LABELS.include_bulk}</option><option value="all">{LISTING_POLICY_LABELS.all}</option></select></label>
          </div>
        </details>
        {error && <p className="generator-error"><FiAlertTriangle /> {error}</p>}
        {requestError && <div className="generator-request-error" role="alert"><div><strong><FiXCircle /> 자동 구성 요청을 완료하지 못했습니다.</strong><p>{requestError}</p><small>현재 입력은 유지됩니다. 조건을 조정하거나 잠시 후 다시 시도해 주세요.</small>{recoveryOptions.length > 0 && <div className="generator-recovery-options"><strong>가능한 조건 완화안</strong>{recoveryOptions.map((option) => <button className="generator-recovery-option" type="button" key={option.id} onClick={() => void applyRecoveryOption(option)} disabled={loading}><span><b>{option.label}</b><small>{option.summary}</small></span><em>{option.changedFields.join(" · ")} · 예상 {option.preview.totalPriceWon.toLocaleString("ko-KR")}원</em></button>)}</div>}</div></div>}
        {requestError && diagnostics.length > 0 && <div className="generator-diagnostics"><strong><FiInfo /> 실패한 조건의 실제 정보</strong>{diagnostics.map((diagnostic) => <article key={diagnostic.id}><b>{diagnostic.title}</b><p>{diagnostic.summary}</p><div>{diagnostic.facts.map((fact) => <span key={`${diagnostic.id}-${fact.label}`}><em>{fact.label}</em><strong>{fact.value}</strong></span>)}</div>{diagnostic.recommendation && <small>{diagnostic.recommendation}</small>}</article>)}</div>}
        {requestError && recoveryOptions.length > 0 && <p className="generator-recovery-preview"><FiInfo /> 부품 미리보기: {recoveryOptions.map((option) => `${option.label} · ${recoveryPreviewText(option)}`).join(" / ")}</p>}
        <button className="button button-primary full-width generator-submit" type="button" onClick={() => void generateFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 호환 조합을 찾는 중...</> : <><FiZap /> 자동 견적 생성</>}</button>
        <details className="generator-comparison-actions" data-testid="generator-comparison-actions">
          <summary><span>비교해서 고르기</span><small>성능 우선·예산 구간</small><FiChevronDown /></summary>
          <div>
            <button className="button button-secondary full-width generator-variants-submit" type="button" onClick={() => void generateVariantsFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 3가지 안을 계산하는 중...</> : <><FiLayers /> 균형형·가성비·성능 3안 비교</>}</button>
            <button className="button button-light full-width generator-budget-submit" type="button" onClick={() => void generateBudgetLadderFromForm()} disabled={loading}>{loading ? <><FiLoader className="spin" /> 예산 구간을 계산하는 중...</> : <><FiActivity /> 예산 구간 3안 비교</>}</button>
          </div>
        </details>
        <p className="generator-note"><FiInfo /> 해상도는 권장 VRAM 기준에, 주사율은 CPU·GPU 성능 비교 가중치에 반영합니다. 실제 FPS가 아니라 현재 카탈로그의 가격·스펙·호환 규칙으로 만든 초안입니다.</p>
      </form>
      {budgetLadder.length > 0 ? <GeneratorBudgetLadderPanel scenarios={budgetLadder} loading={loading} onApply={onApply} onSave={onSave} onCopy={copyBudgetLadder} onDownload={downloadBudgetLadder} share={budgetLadderShare} onShare={() => void shareBudgetLadder()} onRevoke={() => void revokeBudgetLadder()} /> : variants.length > 0 ? <GeneratorVariantsPanel variants={variants} loading={loading} onApply={onApply} onSave={onSave} onAdjustConditions={adjustGeneratorConditions} onCopy={copyGeneratorVariants} onDownload={downloadGeneratorVariants} /> : draft ? <section className="generator-result"><div className="generator-result-top"><div><p className="eyebrow">GENERATED DRAFT</p><h2>{statusLabel}</h2><p>{RECOMMENDATION_PROFILE_LABELS[draft.profile]} · {RECOMMENDATION_PRIORITY_LABELS[draft.priority]}{draft.performanceTier ? ` · ${RECOMMENDATION_PERFORMANCE_TIER_LABELS[draft.performanceTier]}` : ""}{draft.profile === "gaming" ? ` · ${GAMING_RESOLUTION_LABELS[draft.gamingResolution]} · ${GAMING_REFRESH_RATE_LABELS[draft.gamingRefreshRate ?? 144]}` : ""} · RAM {draft.memoryCapacityGb}GB 이상 · {LISTING_POLICY_LABELS[draft.listingPolicy]} · 목표 {formatWon(draft.budgetWon)}</p></div><span className={`generator-status ${draft.withinBudget ? "within" : "over"}`}>{draft.withinBudget ? "예산 내" : "예산 초과"}</span></div><div className="generator-total"><span>예상 부품 합계</span><strong>{formatWon(draft.totalPriceWon)}</strong><small>{draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`}</small></div>{workType && workIntensity && <GeneratorWorkContext workType={workType} intensity={intensity} draft={draft} />}{!workType && draft.profile === "general" && <GeneratorGeneralContext performanceTier={performanceTier} includeGpu={includeGpu} draft={draft} />}{draft.gpuTarget && <div className={`generator-gpu-target ${draft.gpuTarget.currentFit}`}><span>GPU 목표</span><strong>{draft.gpuTarget.summary}</strong></div>}{draft.gamingPerformanceAssessment && <GeneratorGamingEvidence assessment={draft.gamingPerformanceAssessment} gpuTarget={draft.gpuTarget} />}{draft.analysis && <GeneratedAnalysisSummary analysis={draft.analysis} />}<div className="generator-lines">{draft.lines.map((line) => <div className="generator-line" key={line.category}><span><CategoryIcon category={line.category} /> {CATEGORY_LABELS[line.category]}</span><div><strong>{line.name}</strong><small>{line.specSummary ? `${line.specSummary} · ` : ""}{line.quantity > 1 ? `수량 ${line.quantity}개 · ` : ""}{formatWon(line.priceWon * line.quantity)}</small></div></div>)}</div><GeneratorSelectionReasons draft={draft} /><div className="generator-rationale"><strong>구성 기준</strong>{draft.rationale.map((item) => <p key={item}><FiCheck /> {item}</p>)}</div>{draft.warnings.length > 0 && <div className="generator-warnings"><strong><FiAlertTriangle /> 확인할 항목</strong>{draft.warnings.map((item) => <p key={item}>{item}</p>)}</div>}<div className="generator-actions"><button className="button button-secondary" onClick={() => void onApply(draft, false)} disabled={loading}><FiEdit3 /> 편집기로 가져가기</button><button className="button button-primary" onClick={() => void onApply(draft, true)} disabled={loading}><FiActivity /> 가져와서 바로 검사</button>{onSave && <button className="button button-light generator-save-button" onClick={() => onSave(draft)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></section> : <section className="generator-empty"><FiCpu /><h2>조건만 정하면, 견적을 찾아드려요</h2><p>조건을 입력하면 부품을 하나씩 고르기 전에 호환 가능한 기본 구성을 먼저 보여드려요.</p></section>}
    </div>
  </div>;
}

function generatedVariantStatusLabel(status: BuildGenerationResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "검토 필요";
}

function generatedVariantBudgetText(draft: BuildGenerationResult) {
  if (!draft.priceComplete) return "가격 일부 확인 필요";
  return draft.withinBudget ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유` : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`;
}

function generatedAnalysisConfidenceLabel(confidence: BuildAnalysis["confidence"]) {
  return confidence === "high" ? "정보 충분" : confidence === "limited" ? "일부 스펙 기준" : "계산 불가";
}

function generatedAnalysisTone(analysis: BuildAnalysis) {
  if (analysis.overallScore === undefined) return "unknown";
  return analysis.overallScore >= 80 ? "high" : analysis.overallScore >= 60 ? "medium" : "low";
}

function generatedAnalysisBalanceLabel(balance: NonNullable<BuildAnalysis["balance"]>) {
  return balance.status === "balanced" ? "균형형" : balance.status === "cpu_limited" ? "CPU 보완" : "GPU 보완";
}

function generatedVariantAnalysisText(draft: BuildGenerationResult) {
  if (!draft.analysis || draft.analysis.overallScore === undefined) return "계산 불가";
  return `${draft.analysis.overallScore}점 · ${draft.analysis.scoreLabel}`;
}

function generatedVariantSpecText(draft: BuildGenerationResult) {
  return draft.lines.map((line) => `${CATEGORY_LABELS[line.category]} · ${line.specSummary || "핵심 규격 확인 필요"}`).join(" / ");
}

function generatedVariantGamingConditionText(draft: BuildGenerationResult) {
  if (draft.profile !== "gaming") return "게이밍 기준 아님";
  const games = draft.gamingGameIds?.map(gameLabelFor).join(", ") || "일반 게이밍";
  const graphics = draft.gamingGraphicsPreset ? ` · ${GAMING_GRAPHICS_PRESET_LABELS[draft.gamingGraphicsPreset]}` : "";
  const rayTracing = draft.gamingRayTracing ? " · 레이 트레이싱" : "";
  return `${games} · ${GAMING_RESOLUTION_LABELS[draft.gamingResolution]} · ${draft.gamingRefreshRate} FPS${graphics}${rayTracing}`;
}

function recoveryPreviewText(option: BuildGenerationRecoveryOption) {
  const preview = option.preview;
  const budgetText = !preview.priceComplete
    ? "가격 확인 필요"
    : preview.withinBudget
      ? "예산 내"
      : `${Math.abs(preview.budgetDeltaWon).toLocaleString("ko-KR")}원 초과`;
  const reviewText = preview.unknownCount > 0 ? `확인 필요 ${preview.unknownCount}개` : "추가 확인 없음";
  return `${generatedVariantStatusLabel(preview.status)} · ${budgetText} · ${reviewText}`;
}

const generatedDecisionDefinitions: Array<{ kind: SavedBuildComparisonDecisionKind; label: string; description: string }> = [
  { kind: "compatibility", label: "호환 우선", description: "차단·주의·확인 필요를 합산한 위험 점수가 가장 낮은 자동 구성" },
  { kind: "price", label: "가격 우선", description: "가격이 확인된 자동 구성 중 가장 낮은 총액" },
  { kind: "analysis", label: "분석 점수 우선", description: "사용 목적 기준 상대 분석 점수가 가장 높은 자동 구성" }
];

function generatedDecisionStatusText(status: BuildGenerationResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "검토 필요";
}

function GeneratorDecisionSummary({ variants, loading }: { variants: GeneratorVariantResult[]; loading: boolean }) {
  const entries: SavedBuildComparisonEntry[] = variants.flatMap((variant) => variant.draft ? [{ id: variant.priority, name: RECOMMENDATION_PRIORITY_LABELS[variant.priority], result: variant.draft }] : []);
  const partial = entries.length < variants.length;
  const pendingText = loading ? "세 가지 자동 구성 결과를 기다리는 중입니다." : entries.length === 0 ? "생성된 자동 구성 결과가 없습니다." : "생성에 성공한 구성 중 우선 부품을 계산해요.";
  const decisionIds = generatedDecisionDefinitions.map((definition) => savedBuildComparisonDecisionFor(entries, definition.kind)?.entry.id).filter((id): id is string => Boolean(id));
  const sameDecisionForAllCriteria = decisionIds.length === generatedDecisionDefinitions.length && new Set(decisionIds).size === 1;
  return <section className="generator-decision-summary" aria-label="자동 구성 기준별 비교 결과">
    <div className="generator-decision-heading"><div><p className="eyebrow">DECISION SUMMARY</p><h3>기준별 비교 결과</h3><p>세 안을 호환·가격·분석 점수 기준으로 따로 비교합니다.</p></div><span>{entries.length} / {variants.length}개 생성 완료</span></div>
    <div className="generator-decision-grid">
      {generatedDecisionDefinitions.map((definition) => {
        const decision = savedBuildComparisonDecisionFor(entries, definition.kind);
        const selectedVariant = decision ? variants.find((variant) => variant.priority === decision.entry.id) : undefined;
        const metricText = decision
          ? definition.kind === "compatibility"
            ? `위험 ${decision.metric}점 · ${generatedDecisionStatusText(decision.entry.result.status)} · 차단 ${decision.entry.result.blockerCount}개`
            : definition.kind === "price"
              ? `총액 ${formatWon(decision.metric)} · ${selectedVariant?.draft ? generatedVariantBudgetText(selectedVariant.draft) : "예산 확인 필요"}`
              : `상대 분석 ${decision.metric}점 · ${generatedDecisionStatusText(decision.entry.result.status)}`
          : pendingText;
        return <article className={decision ? "generator-decision-card selected" : "generator-decision-card pending"} key={definition.kind}><span>{definition.label}</span>{decision ? <><strong>{decision.entry.name}</strong><small>{metricText}</small><em>{partial ? "생성에 성공한 안 중 우선" : definition.description}</em></> : <><strong>계산 대기</strong><small>{metricText}</small><em>{definition.description}</em></>}</article>;
      })}
    </div>
    <p className="generator-decision-note"><FiInfo /> {sameDecisionForAllCriteria ? "호환·가격·분석 점수가 현재 같은 구성을 가리킵니다. 우선순위를 바꿔도 현재 조건에서는 부품 조합이 달라지지 않았습니다." : "자동 구성의 결정 요약은 현재 카탈로그의 호환성·가격·상대 분석 기준입니다."} 실제 BIOS·QVL·온도·소음·게임 FPS를 확정하는 순위가 아닙니다.</p>
  </section>;
}

function GeneratedAnalysisSummary({ analysis, compact = false }: { analysis: BuildAnalysis; compact?: boolean }) {
  const insights = [...analysis.focusAreas.slice(0, compact ? 1 : 2), ...analysis.strengths.slice(0, compact ? 1 : 2)];
  const nextActions = analysis.nextActions.slice(0, compact ? 1 : 3);
  return <div className={`generator-analysis ${compact ? "compact" : ""}`}>
    <div className="generator-analysis-top"><div><p className="eyebrow">CATALOG ANALYSIS</p><strong>구성 성능·확장성 요약</strong></div><span className={`generator-analysis-score ${generatedAnalysisTone(analysis)}`}><b>{analysis.overallScore ?? "-"}</b><small>{analysis.scoreLabel}</small></span></div>
    <div className="generator-analysis-stats"><div><span>분석 정보</span><strong>{generatedAnalysisConfidenceLabel(analysis.confidence)}</strong></div>{analysis.balance && <div><span>CPU · GPU 밸런스</span><strong>{generatedAnalysisBalanceLabel(analysis.balance)}</strong></div>}<div><span>우선 확인</span><strong>{analysis.bottlenecks.length > 0 ? `${analysis.bottlenecks.length}개 항목` : "큰 문제 없음"}</strong></div></div>
    {insights.length > 0 && <div className="generator-analysis-insights">{insights.map((insight) => <div key={`${insight.category}-${insight.title}`}><span>{insight.title}</span><strong>{insight.score}점</strong>{!compact && <small>{insight.summary}</small>}</div>)}</div>}
    {!compact && <div className="generator-analysis-actions"><span>추천 확인 순서</span>{nextActions.map((action, index) => <p key={action}><b>{index + 1}</b>{action}</p>)}</div>}
    {!compact && <p className="generator-analysis-note"><FiInfo /> 실제 FPS·렌더링 벤치마크가 아닌, 현재 카탈로그의 확인된 스펙을 같은 범주 안에서 비교한 참고 점수입니다.</p>}
  </div>;
}

function GeneratorSelectionReasons({ draft }: { draft: BuildGenerationResult }) {
  const lines = draft.lines.filter((line) => Boolean(line.selectionReason));
  if (lines.length === 0) return null;
  return <details className="generator-selection-reasons" data-testid="generator-selection-reasons">
    <summary><span><FiInfo /> 부품을 고른 이유</span><small>조건·호환·예산 기준</small><FiChevronDown /></summary>
    <div>{lines.map((line) => <article key={line.category}><div><span>{CATEGORY_LABELS[line.category]}</span><strong>{line.name}</strong></div><p>{line.selectionReason}</p></article>)}</div>
  </details>;
}

function GeneratorVariantReasons({ draft }: { draft: BuildGenerationResult }) {
  const lines = draft.lines.filter((line) => Boolean(line.selectionReason));
  if (lines.length === 0) return null;
  return <details className="generator-variant-reasons" data-testid={`generator-variant-reasons-${draft.priority}`}>
    <summary><span><FiInfo /> 선택 이유</span><small>{lines.length}개 부품 기준</small><FiChevronDown /></summary>
    <div>{lines.map((line) => <article key={line.category}><div><span>{CATEGORY_LABELS[line.category]}</span><strong>{line.name}</strong></div><p>{line.selectionReason}</p></article>)}</div>
  </details>;
}

function generatedVariantLineText(draft: BuildGenerationResult, category: PartCategory) {
  const line = draft.lines.find((item) => item.category === category);
  return line ? `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}` : "미포함";
}

function generatorVariantsTextFor(variants: GeneratorVariantResult[]) {
  const lines = ["PC Supporter 자동 구성 3안 비교", ""];
  variants.forEach((variant) => {
    const label = RECOMMENDATION_PRIORITY_LABELS[variant.priority];
    lines.push(`[${label}]`);
    if (!variant.draft) {
      lines.push(`- 상태: 생성 실패`, `- 오류: ${variant.error ?? "자동 구성을 만들지 못했습니다."}`, "");
      return;
    }
    const analysis = variant.draft.analysis?.overallScore === undefined ? "계산 불가" : `${variant.draft.analysis.overallScore}점`;
    lines.push(`- 상태: ${generatedVariantStatusLabel(variant.draft.status)}`);
    lines.push(`- 예상 합계: ${formatWon(variant.draft.totalPriceWon)}`);
    lines.push(`- 예산: ${generatedVariantBudgetText(variant.draft)}`);
    lines.push(`- 카탈로그 분석: ${analysis}`);
    lines.push(`- 위험: 차단 ${variant.draft.blockerCount}개 · 주의 ${variant.draft.warningCount}개 · 확인 필요 ${variant.draft.unknownCount}개`);
    PART_CATEGORIES.forEach((category) => lines.push(`- ${CATEGORY_LABELS[category]}: ${generatedVariantLineText(variant.draft!, category)}`));
    lines.push("");
  });
  return lines.join("\n");
}

function generatorVariantsJsonFor(variants: GeneratorVariantResult[]) {
  const payload: GeneratorVariantsExportPayload = {
    type: GENERATOR_VARIANTS_EXPORT_TYPE,
    version: GENERATOR_VARIANTS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    items: variants.map((variant) => ({
      priority: variant.priority,
      label: RECOMMENDATION_PRIORITY_LABELS[variant.priority],
      status: variant.draft ? generatedVariantStatusLabel(variant.draft.status) : "생성 실패",
      ...(variant.error ? { error: variant.error } : {}),
      ...(variant.draft ? {
        draft: variant.draft,
        totalPriceWon: variant.draft.totalPriceWon,
        budgetDeltaWon: variant.draft.budgetDeltaWon,
        analysisScore: variant.draft.analysis?.overallScore,
        blockerCount: variant.draft.blockerCount,
        warningCount: variant.draft.warningCount,
        unknownCount: variant.draft.unknownCount,
        lines: PART_CATEGORIES.map((category) => {
          const line = variant.draft!.lines.find((item) => item.category === category);
          return { category, label: CATEGORY_LABELS[category], name: line?.name ?? "미포함", partId: line?.partId, quantity: line?.quantity ?? 0 };
        })
      } : {})
    }))
  };
  return JSON.stringify(payload, null, 2);
}

function generatorVariantsRequestFor(variants: GeneratorVariantResult[]): BuildGenerationRequest | undefined {
  const draft = variants.find((variant) => variant.draft)?.draft;
  if (!draft) return undefined;
  return {
    profile: draft.profile,
    priority: draft.priority,
    ...(draft.performanceTier ? { performanceTier: draft.performanceTier } : {}),
    budgetWon: draft.budgetWon,
    includeGpu: Boolean(draft.selection.gpu),
    gamingResolution: draft.gamingResolution,
    gamingRefreshRate: draft.gamingRefreshRate,
    ...(draft.gamingGameIds ? { gamingGameIds: draft.gamingGameIds } : {}),
    ...(draft.gamingGraphicsPreset ? { gamingGraphicsPreset: draft.gamingGraphicsPreset } : {}),
    ...(draft.gamingRayTracing !== undefined ? { gamingRayTracing: draft.gamingRayTracing } : {}),
    ...(draft.gamingUpscaling ? { gamingUpscaling: draft.gamingUpscaling } : {}),
    memoryCapacityGb: draft.memoryCapacityGb,
    storageCapacityGb: draft.storageCapacityGb,
    ...(draft.hddCapacityGb !== undefined ? { hddCapacityGb: draft.hddCapacityGb } : {}),
    hddCount: draft.hddCount,
    includeNonRetail: draft.includeNonRetail,
    listingPolicy: draft.listingPolicy
  };
}

type GeneratorVariantImportPreviewItem = {
  priority: RecommendationPriority;
  label: string;
  status: string;
  totalPriceWon?: number;
  analysisScore?: number;
  error?: string;
};

function usableImportedPartSelection(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  return typeof selection.partId === "string" && selection.partId.trim().length > 0 && selection.partId.length <= BUILD_INPUT_MAX_ID_LENGTH
    && Number.isInteger(selection.quantity) && (selection.quantity as number) >= 1 && (selection.quantity as number) <= 99;
}

function usableImportedOptionalId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim().length > 0 && value.length <= BUILD_INPUT_MAX_ID_LENGTH);
}

// 가져온 draft.selection은 "편집기로 가져가기"가 그대로 setBuild·호환 검사에 쓰는 값이다.
// apply 버튼을 열기 전에 편집기가 읽을 수 있는 모양인지 여기서 끝내 확인한다.
// 검사 기준은 shared/build-transfer.ts의 견적 JSON 파서와 같은 필드·한계를 쓴다.
function usableImportedBuildSelection(value: unknown): value is BuildSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  const singlesOk = ["cpu", "cooler", "motherboard", "gpu", "case", "psu"].every((key) => selection[key] === undefined || usableImportedPartSelection(selection[key]));
  const listsOk = ["memory", "ssd", "hdd"].every((key) => {
    const list = selection[key];
    return Array.isArray(list) && list.length <= BUILD_INPUT_MAX_SELECTIONS_PER_LIST && list.every(usableImportedPartSelection);
  });
  const accessories = selection.accessories;
  const accessoriesOk = accessories === undefined || (Array.isArray(accessories) && accessories.length <= BUILD_INPUT_MAX_SELECTIONS_PER_LIST && accessories.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const accessory = item as Record<string, unknown>;
    return typeof accessory.accessoryId === "string" && accessory.accessoryId.trim().length > 0 && accessory.accessoryId.length <= BUILD_INPUT_MAX_ID_LENGTH
      && Number.isInteger(accessory.quantity) && (accessory.quantity as number) >= 1 && (accessory.quantity as number) <= 99
      && usableImportedOptionalId(accessory.targetPartId)
      && usableImportedOptionalId(accessory.targetAccessoryId);
  }));
  const useIntegratedGraphics = selection.useIntegratedGraphics;
  const m2SlotSelection = selection.m2SlotSelection;
  const m2SlotSelectionOk = m2SlotSelection === undefined || (Boolean(m2SlotSelection) && typeof m2SlotSelection === "object" && !Array.isArray(m2SlotSelection)
    && Object.keys(m2SlotSelection as Record<string, unknown>).length <= BUILD_INPUT_MAX_M2_SLOTS
    && Object.entries(m2SlotSelection as Record<string, unknown>).every(([slotId, partId]) => /^M2_[1-8]$/.test(slotId) && typeof partId === "string" && partId.trim().length > 0 && partId.length <= BUILD_INPUT_MAX_ID_LENGTH));
  const flagsOk = (useIntegratedGraphics === undefined || typeof useIntegratedGraphics === "boolean")
    && usableImportedOptionalId(selection.rgbControllerAccessoryId);
  return singlesOk && listsOk && accessoriesOk && m2SlotSelectionOk && flagsOk;
}

function usableImportedVariantDraft(value: unknown, expectedPriority?: RecommendationPriority): value is BuildGenerationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  if (!["compatible", "needs_review", "incompatible"].includes(String(draft.status))) return false;
  if (typeof draft.profile !== "string" || !Object.prototype.hasOwnProperty.call(RECOMMENDATION_PROFILE_LABELS, draft.profile)) return false;
  if (!isRecommendationPriority(draft.priority) || (expectedPriority !== undefined && draft.priority !== expectedPriority)) return false;
  if (typeof draft.listingPolicy !== "string" || !Object.prototype.hasOwnProperty.call(LISTING_POLICY_LABELS, draft.listingPolicy)) return false;
  if (!Number.isFinite(draft.totalPriceWon) || !Number.isFinite(draft.budgetWon) || !Number.isFinite(draft.budgetDeltaWon) || typeof draft.withinBudget !== "boolean" || typeof draft.priceComplete !== "boolean" || typeof draft.includeNonRetail !== "boolean") return false;
  if (!Number.isInteger(draft.blockerCount) || Number(draft.blockerCount) < 0 || !Number.isInteger(draft.warningCount) || Number(draft.warningCount) < 0 || !Number.isInteger(draft.unknownCount) || Number(draft.unknownCount) < 0 || !Number.isInteger(draft.memoryCapacityGb) || Number(draft.memoryCapacityGb) < 0 || !Number.isInteger(draft.storageCapacityGb) || Number(draft.storageCapacityGb) < 0 || !Number.isInteger(draft.hddCount) || Number(draft.hddCount) < 0) return false;
  if (!Array.isArray(draft.lines) || draft.lines.length === 0 || !Array.isArray(draft.warnings) || !draft.warnings.every((warning) => typeof warning === "string") || !Array.isArray(draft.rationale) || !draft.rationale.every((item) => typeof item === "string")) return false;
  const lineCategories = draft.lines.map((line) => line && typeof line === "object" && !Array.isArray(line) ? (line as Record<string, unknown>).category : undefined);
  if (new Set(lineCategories).size !== lineCategories.length) return false;
  if (!draft.lines.every((line) => Boolean(line) && typeof line === "object" && !Array.isArray(line) && PART_CATEGORIES.includes((line as Record<string, unknown>).category as PartCategory) && typeof (line as Record<string, unknown>).partId === "string" && typeof (line as Record<string, unknown>).name === "string" && Number.isInteger((line as Record<string, unknown>).quantity) && Number((line as Record<string, unknown>).quantity) >= 0 && Number.isFinite((line as Record<string, unknown>).priceWon) && Number((line as Record<string, unknown>).priceWon) >= 0)) return false;
  if (typeof draft.gamingResolution !== "string" || !Object.prototype.hasOwnProperty.call(GAMING_RESOLUTION_LABELS, draft.gamingResolution) || typeof draft.gamingRefreshRate !== "number" || !Object.prototype.hasOwnProperty.call(GAMING_REFRESH_RATE_LABELS, draft.gamingRefreshRate)) return false;
  if (draft.performanceTier !== undefined && (typeof draft.performanceTier !== "string" || !Object.prototype.hasOwnProperty.call(RECOMMENDATION_PERFORMANCE_TIER_LABELS, draft.performanceTier))) return false;
  if (!usableImportedBuildSelection(draft.selection)) return false;
  if (draft.analysis !== undefined) {
    const analysis = draft.analysis as Record<string, unknown>;
    if (!analysis || typeof analysis !== "object" || !Array.isArray(analysis.focusAreas) || !Array.isArray(analysis.strengths) || !Array.isArray(analysis.bottlenecks) || !Array.isArray(analysis.nextActions) || typeof analysis.scoreLabel !== "string" || typeof analysis.confidence !== "string") return false;
  }
  return true;
}

export function generatorVariantsImportPreviewFor(value: unknown): { items?: GeneratorVariantImportPreviewItem[]; variants?: GeneratorVariantResult[]; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "JSON 객체 형식이 아닙니다." };
  const record = value as Record<string, unknown>;
  if (record.type !== GENERATOR_VARIANTS_EXPORT_TYPE || record.version !== GENERATOR_VARIANTS_EXPORT_VERSION || !Array.isArray(record.items)) return { error: "자동 구성 3안 비교 JSON 형식이 아닙니다." };
  if (record.items.length < 1 || record.items.length > 3) return { error: "자동 구성 결과는 1개 이상 3개 이하만 가져올 수 있습니다." };
  const priorities = ["balanced", "budget", "performance"] as const;
  const items = record.items.flatMap((item): GeneratorVariantImportPreviewItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (!priorities.includes(candidate.priority as typeof priorities[number]) || typeof candidate.label !== "string" || typeof candidate.status !== "string") return [];
    const totalPriceWon = candidate.totalPriceWon === undefined ? undefined : typeof candidate.totalPriceWon === "number" && Number.isFinite(candidate.totalPriceWon) ? candidate.totalPriceWon : undefined;
    const analysisScore = candidate.analysisScore === undefined ? undefined : typeof candidate.analysisScore === "number" && Number.isFinite(candidate.analysisScore) ? candidate.analysisScore : undefined;
    const error = candidate.error === undefined ? undefined : typeof candidate.error === "string" ? candidate.error : undefined;
    return [{ priority: candidate.priority as RecommendationPriority, label: candidate.label, status: candidate.status, ...(totalPriceWon !== undefined ? { totalPriceWon } : {}), ...(analysisScore !== undefined ? { analysisScore } : {}), ...(error ? { error } : {}) }];
  });
  if (items.length !== record.items.length || new Set(items.map((item) => item.priority)).size !== items.length) return { error: "자동 구성 JSON의 우선순위·상태를 확인할 수 없습니다." };
  const variants = record.items.flatMap((item): GeneratorVariantResult[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const priority = priorities.includes(candidate.priority as typeof priorities[number]) ? candidate.priority as RecommendationPriority : undefined;
    return priority && usableImportedVariantDraft(candidate.draft, priority) ? [{ priority, draft: candidate.draft }] : [];
  });
  return { items, ...(variants.length === record.items.length ? { variants } : {}) };
}

function generatedVariantConfigurationChangesText(draft: BuildGenerationResult, previousVariants: GeneratorVariantResult[], hasPreviousVariant: boolean) {
  if (!hasPreviousVariant) return "기준 구성";
  const currentSignature = generatedVariantSignature(draft);
  const matchingVariant = previousVariants.find((variant) => variant.draft && generatedVariantSignature(variant.draft) === currentSignature);
  const previousDraft = previousVariants[previousVariants.length - 1]?.draft;
  if (matchingVariant) {
    return matchingVariant === previousVariants[previousVariants.length - 1]
      ? "직전 안과 동일"
      : `${RECOMMENDATION_PRIORITY_LABELS[matchingVariant.priority]}과 동일`;
  }
  if (!previousDraft) return "이전 안 확인 필요";
  const changedCategories = PART_CATEGORIES.filter((category) => {
    const before = previousDraft.lines.find((line) => line.category === category);
    const after = draft.lines.find((line) => line.category === category);
    return `${before?.partId ?? ""}:${before?.quantity ?? 0}` !== `${after?.partId ?? ""}:${after?.quantity ?? 0}`;
  });
  return changedCategories.length === 0 ? "직전 안과 동일" : `${changedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")} 변경`;
}

function generatedVariantSignature(draft: BuildGenerationResult) {
  return draft.lines.map((line) => `${line.category}:${line.partId}:${line.quantity}`).join("|");
}

function GeneratorVariantTradeoffSummary({ variants }: { variants: GeneratorVariantResult[] }) {
  const drafts = variants.flatMap((variant) => variant.draft ? [{ variant, draft: variant.draft }] : []);
  if (drafts.length === 0) return null;
  const configurationCount = new Set(drafts.map(({ draft }) => generatedVariantSignature(draft))).size;
  const prices = drafts.map(({ draft }) => draft.totalPriceWon).filter((value) => Number.isFinite(value));
  const priceMin = prices.length > 0 ? Math.min(...prices) : undefined;
  const priceMax = prices.length > 0 ? Math.max(...prices) : undefined;
  const priceDelta = priceMin !== undefined && priceMax !== undefined ? priceMax - priceMin : undefined;
  const analyses = drafts.flatMap(({ variant, draft }) => draft.analysis?.overallScore === undefined ? [] : [{ variant, score: draft.analysis.overallScore }]);
  const analysisMin = analyses.length > 0 ? Math.min(...analyses.map(({ score }) => score)) : undefined;
  const analysisMax = analyses.length > 0 ? Math.max(...analyses.map(({ score }) => score)) : undefined;
  const analysisDelta = analysisMin !== undefined && analysisMax !== undefined ? analysisMax - analysisMin : undefined;
  const changedCategories = PART_CATEGORIES.filter((category) => new Set(drafts.map(({ draft }) => {
    const line = draft.lines.find((item) => item.category === category);
    return `${line?.partId ?? ""}:${line?.quantity ?? 0}`;
  })).size > 1);
  const highestAnalysis = analyses.find(({ score }) => score === analysisMax);
  const duplicateGroups = new Map<string, string[]>();
  drafts.forEach(({ variant, draft }) => {
    const signature = generatedVariantSignature(draft);
    duplicateGroups.set(signature, [...(duplicateGroups.get(signature) ?? []), RECOMMENDATION_PRIORITY_LABELS[variant.priority]]);
  });
  const repeatedGroups = [...duplicateGroups.values()].filter((group) => group.length > 1);
  const priceText = priceMin === undefined || priceMax === undefined ? "확인 필요" : priceMin === priceMax ? formatWon(priceMin) : `${formatWon(priceMin)} ~ ${formatWon(priceMax)}`;
  const analysisText = analysisMin === undefined || analysisMax === undefined ? "계산 불가" : analysisMin === analysisMax ? `${analysisMin}점` : `${analysisMin}점 ~ ${analysisMax}점`;
  return <section className="generator-variant-tradeoff-summary" data-testid="generator-variant-tradeoff-summary" aria-label="자동 구성 비교 결과"><div className="generator-variant-tradeoff-heading"><div><p className="eyebrow">COMPARISON SUMMARY</p><strong>비교 결과</strong></div><span>{configurationCount}종 구성</span></div><div className="generator-variant-tradeoff-grid"><article><span>구성</span><strong>{configurationCount}종</strong><small>{configurationCount === 1 ? "세 안이 같은 부품 조합" : `${configurationCount}종 부품 구성을 비교`}</small></article><article><span>총액</span><strong>{priceText}</strong><small>{priceDelta === undefined || priceDelta === 0 ? "총액 차이 없음" : `가격 차이 ${formatWon(priceDelta)}`}</small></article><article><span>카탈로그 분석</span><strong>{analysisText}</strong><small>{analysisDelta === undefined || analysisDelta === 0 ? "분석 점수 차이 없음" : `점수 차이 ${analysisDelta}점${highestAnalysis ? ` · 최고 ${RECOMMENDATION_PRIORITY_LABELS[highestAnalysis.variant.priority]}` : ""}`}</small></article><article><span>부품 변경</span><strong>{changedCategories.length === 0 ? "없음" : `${changedCategories.length}개 항목`}</strong><small>{changedCategories.length === 0 ? "모든 안의 부품 동일" : changedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")}</small></article></div>{repeatedGroups.length > 0 && <p className="generator-variant-tradeoff-note"><FiInfo /> 같은 구성: {repeatedGroups.map((group) => group.join(" · ")).join(" / ")}</p>}</section>;
}

function GeneratorVariantsPanel({ variants: sourceVariants, loading, onApply, onSave, onAdjustConditions, onCopy, onDownload }: { variants: GeneratorVariantResult[]; loading: boolean; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void; onAdjustConditions: () => void; onCopy: (variants: GeneratorVariantResult[]) => Promise<void>; onDownload: (variants: GeneratorVariantResult[]) => void }) {
  const variantImportInputRef = useRef<HTMLInputElement | null>(null);
  const [variantImportPreview, setVariantImportPreview] = useState<GeneratorVariantImportPreviewItem[] | null>(null);
  const [variantImportCandidate, setVariantImportCandidate] = useState<GeneratorVariantResult[] | null>(null);
  const [importedVariants, setImportedVariants] = useState<GeneratorVariantResult[] | null>(null);
  const [variantImportError, setVariantImportError] = useState<string | null>(null);
  const [localHistory, setLocalHistory] = useState<GeneratorVariantsLocalHistoryEntry[]>(() => typeof window === "undefined" ? [] : generatorVariantsLocalHistoryFromJson(window.localStorage.getItem(GENERATOR_VARIANTS_LOCAL_HISTORY_KEY)));
  const [shareLink, setShareLink] = useState<GeneratorVariantsLocalShareEntry | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [localShares, setLocalShares] = useState<GeneratorVariantsLocalShareEntry[]>(() => typeof window === "undefined" ? [] : generatorVariantsLocalSharesFromJson(window.localStorage.getItem(GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY)));
  const importedSourceVariantsRef = useRef<GeneratorVariantResult[] | null>(null);
  const shareMutationRef = useRef(0);
  const panelMountedRef = useRef(true);
  useEffect(() => {
    importedSourceVariantsRef.current = null;
    setImportedVariants(null);
    setVariantImportPreview(null);
    setVariantImportCandidate(null);
    setVariantImportError(null);
    setShareLink(null);
    setShareError(null);
  }, [sourceVariants]);
  useEffect(() => {
    panelMountedRef.current = true;
    return () => {
      panelMountedRef.current = false;
      shareMutationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    try {
      if (localHistory.length > 0) window.localStorage.setItem(GENERATOR_VARIANTS_LOCAL_HISTORY_KEY, generatorVariantsLocalHistoryToJson(localHistory));
      else window.localStorage.removeItem(GENERATOR_VARIANTS_LOCAL_HISTORY_KEY);
    } catch {
      // A full local storage bucket must not block comparison results.
    }
  }, [localHistory]);
  useEffect(() => {
    try {
      if (localShares.length > 0) window.localStorage.setItem(GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY, generatorVariantsLocalSharesToJson(localShares));
      else window.localStorage.removeItem(GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY);
    } catch {
      // A full local storage bucket must not block comparison results.
    }
  }, [localShares]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === GENERATOR_VARIANTS_LOCAL_HISTORY_KEY) setLocalHistory(generatorVariantsLocalHistoryFromJson(event.newValue));
      if (event.key === GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY) setLocalShares(generatorVariantsLocalSharesFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const importedViewActive = importedVariants !== null && importedSourceVariantsRef.current === sourceVariants;
  const variants = importedViewActive && importedVariants ? importedVariants : sourceVariants;
  const readyVariants = variants.filter((variant): variant is GeneratorVariantResult & { draft: BuildGenerationResult } => Boolean(variant.draft));
  const uniqueConfigurationCount = new Set(readyVariants.map((variant) => generatedVariantSignature(variant.draft))).size;
  const sameConfigurationNotice = readyVariants.length > 1 && uniqueConfigurationCount === 1;
  const configurationCounts = new Map<string, number>();
  readyVariants.forEach((variant) => {
    const signature = generatedVariantSignature(variant.draft);
    configurationCounts.set(signature, (configurationCounts.get(signature) ?? 0) + 1);
  });
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "상태", values: variants.map((variant) => variant.draft ? generatedVariantStatusLabel(variant.draft.status) : "생성 실패") },
    { label: "예상 합계", values: variants.map((variant) => variant.draft ? formatWon(variant.draft.totalPriceWon) : "-") },
    { label: "예산", values: variants.map((variant) => variant.draft ? generatedVariantBudgetText(variant.draft) : "-") },
    { label: "게임 조건", values: variants.map((variant) => variant.draft ? generatedVariantGamingConditionText(variant.draft) : "-") },
    { label: "카탈로그 분석", values: variants.map((variant) => variant.draft ? generatedVariantAnalysisText(variant.draft) : "-") },
    { label: "핵심 규격", values: variants.map((variant) => variant.draft ? generatedVariantSpecText(variant.draft) : "-") },
    { label: "구성 차이", values: variants.map((variant, index) => variant.draft ? generatedVariantConfigurationChangesText(variant.draft, variants.slice(0, index), index > 0) : "-") },
    { label: "차단 오류", values: variants.map((variant) => variant.draft ? `${variant.draft.blockerCount}개` : "-") },
    { label: "주의", values: variants.map((variant) => variant.draft ? `${variant.draft.warningCount}개` : "-") },
    { label: "확인 필요", values: variants.map((variant) => variant.draft ? `${variant.draft.unknownCount}개` : "-") },
    ...PART_CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], values: variants.map((variant) => variant.draft ? generatedVariantLineText(variant.draft, category) : "-") }))
  ];
  async function importVariantJson(file: File | undefined) {
    if (!file) return;
    setVariantImportError(null);
    setVariantImportPreview(null);
    setVariantImportCandidate(null);
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      setVariantImportError("JSON 파일은 1MB 이하만 가져올 수 있습니다.");
      return;
    }
    try {
      const parsed = generatorVariantsImportPreviewFor(JSON.parse(await file.text()));
      if (parsed.error || !parsed.items) {
        setVariantImportError(parsed.error ?? "자동 구성 결과를 읽지 못했습니다.");
        return;
      }
      setVariantImportPreview(parsed.items);
      setVariantImportCandidate(parsed.variants ?? null);
    } catch {
      setVariantImportError("JSON 파일을 읽지 못했습니다.");
    }
  }
  function applyImportedVariants() {
    if (!variantImportCandidate) return;
    importedSourceVariantsRef.current = sourceVariants;
    setImportedVariants(variantImportCandidate);
    setVariantImportPreview(null);
    setVariantImportCandidate(null);
    setVariantImportError(null);
  }
  function returnToCurrentVariants() {
    importedSourceVariantsRef.current = null;
    setImportedVariants(null);
  }
  function adjustConditionsFromImportedVariants() {
    importedSourceVariantsRef.current = null;
    setImportedVariants(null);
    setVariantImportPreview(null);
    setVariantImportCandidate(null);
    onAdjustConditions();
  }
  function saveVariantsToLocalHistory() {
    const createdAt = new Date().toISOString();
    const entry: GeneratorVariantsLocalHistoryEntry = {
      id: `generator-variants-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `자동 구성 3안 · ${new Date(createdAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}`,
      createdAt,
      payload: generatorVariantsJsonFor(variants)
    };
    setLocalHistory((current) => generatorVariantsLocalHistoryRemember(current, entry));
  }
  function openLocalHistoryEntry(entry: GeneratorVariantsLocalHistoryEntry) {
    try {
      const parsed = generatorVariantsImportPreviewFor(JSON.parse(entry.payload));
      if (parsed.error || !parsed.items) {
        setVariantImportError(parsed.error ?? "저장한 비교 결과를 읽지 못했습니다.");
        return;
      }
      setVariantImportError(null);
      setVariantImportPreview(parsed.items);
      setVariantImportCandidate(parsed.variants ?? null);
    } catch {
      setVariantImportError("저장한 비교 결과를 읽지 못했습니다.");
    }
  }
  function removeLocalHistoryEntry(id: string) {
    setLocalHistory((current) => generatorVariantsLocalHistoryRemove(current, id));
  }
  async function shareVariants() {
    if (sharing) return;
    if (readyVariants.length === 0) {
      setShareError("공유할 수 있는 완성된 구성이 없습니다.");
      return;
    }
    const requestVersion = ++shareMutationRef.current;
    const isCurrent = () => panelMountedRef.current && shareMutationRef.current === requestVersion;
    setSharing(true);
    setShareError(null);
    try {
      const saved = await api<GeneratorVariantsShareSnapshot & { ownerToken: string }>("/api/generator-variants", {
        method: "POST",
        body: JSON.stringify({ name: "PC Supporter 자동 구성 3안 비교", payload: JSON.parse(generatorVariantsJsonFor(variants)), ...(generatorVariantsRequestFor(variants) ? { request: generatorVariantsRequestFor(variants) } : {}), expiresInDays: 30 }),
        retry: 0
      });
      if (!isCurrent()) return;
      const entry: GeneratorVariantsLocalShareEntry = { id: saved.id, url: `${window.location.origin}/generator-variants/${saved.id}`, name: saved.name, createdAt: saved.createdAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ownerToken: saved.ownerToken };
      setLocalShares((current) => generatorVariantsLocalShareRemember(current, entry));
      setShareLink(entry);
      try {
        await navigator.clipboard.writeText(entry.url);
      } catch {
        // The visible link remains available when clipboard permission is unavailable.
      }
    } catch (error: unknown) {
      if (isCurrent()) setShareError(error instanceof Error ? error.message : "자동 구성 비교 공유 링크를 만들지 못했습니다.");
    } finally {
      if (isCurrent()) setSharing(false);
    }
  }
  async function revokeSharedVariants(entry: GeneratorVariantsLocalShareEntry) {
    if (sharing || !window.confirm("이 자동 구성 비교 공유 링크를 취소할까요? 전달된 링크도 더 이상 열리지 않습니다.")) return;
    const requestVersion = ++shareMutationRef.current;
    const isCurrent = () => panelMountedRef.current && shareMutationRef.current === requestVersion;
    setSharing(true);
    setShareError(null);
    try {
      await api(`/api/generator-variants/${encodeURIComponent(entry.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": entry.ownerToken ?? "" }, retry: 0 });
      if (!isCurrent()) return;
      setLocalShares((current) => generatorVariantsLocalShareRemove(current, entry.id));
      setShareLink((current) => current?.id === entry.id ? null : current);
    } catch (error: unknown) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.status === 404) {
        setLocalShares((current) => generatorVariantsLocalShareRemove(current, entry.id));
        setShareLink((current) => current?.id === entry.id ? null : current);
        return;
      }
      setShareError(error instanceof Error ? error.message : "자동 구성 비교 공유 링크를 취소하지 못했습니다.");
    } finally {
      if (isCurrent()) setSharing(false);
    }
  }
  return <section className="generator-variants" aria-label="자동 구성 추천안 비교">
    <div className="generator-variants-heading"><div><p className="eyebrow">RECOMMENDATION OPTIONS</p><h2>자동 구성 3안 비교</h2><p>같은 사용 목적·예산·저장 조건으로 우선순위만 바꿔 세 가지 구성을 비교합니다.</p></div><div className="generator-variants-heading-actions"><span><FiLayers /> {readyVariants.length} / {variants.length}{importedViewActive ? "개 가져옴" : "개 생성"} · 구성 {uniqueConfigurationCount}종</span><div className="generator-variants-export-actions"><button className="text-button" type="button" data-testid="generator-variants-copy" onClick={() => void onCopy(variants)}><FiCopy /> 비교 복사</button><button className="text-button" type="button" data-testid="generator-variants-json" onClick={() => onDownload(variants)}><FiDownload /> JSON 저장</button><button className="text-button" type="button" data-testid="generator-variants-save-history" onClick={saveVariantsToLocalHistory}><FiSave /> 비교 저장</button><input ref={variantImportInputRef} className="generator-saved-preset-file" type="file" accept=".json,application/json" aria-label="자동 구성 3안 비교 JSON 가져오기" onChange={(event) => { void importVariantJson(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={loading} /><button className="text-button" type="button" data-testid="generator-variants-import" onClick={() => variantImportInputRef.current?.click()} disabled={loading}><FiUpload /> JSON 가져오기</button></div></div></div>
    <div className="generator-variants-share-actions"><button className="text-button" type="button" data-testid="generator-variants-share" onClick={() => void shareVariants()} disabled={loading || sharing || readyVariants.length === 0}><FiShare2 /> {sharing ? "공유 처리 중..." : shareLink ? "링크 다시 만들기" : "공유 링크"}</button>{shareError && <span className="generator-variants-share-error" role="status">{shareError}</span>}</div>
    {shareLink && <div className="generator-variants-share-preview" role="status" data-testid="generator-variants-share-preview"><label><span>공유 링크{shareLink.expiresAt ? ` · ${new Date(shareLink.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="자동 구성 3안 비교 공유 링크" type="text" value={shareLink.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div><a className="text-button" href={shareLink.url}><FiShare2 /> 열기</a><button className="text-button danger-text-button" type="button" data-testid="generator-variants-share-revoke-current" onClick={() => void revokeSharedVariants(shareLink)} disabled={sharing}><FiTrash2 /> 공유 취소</button></div></div>}
    {localShares.length > 0 && <details className="generator-variants-local-history" data-testid="generator-variants-local-shares"><summary><span>공유한 비교 링크</span><small>{localShares.length}개</small><FiChevronDown /></summary><div>{localShares.map((entry) => { const expired = generatorVariantsLocalShareExpired(entry); return <article key={entry.id}><div><strong>{entry.name}</strong><small>{new Date(entry.createdAt).toLocaleString("ko-KR")}{entry.expiresAt ? ` · ${expired ? "만료됨" : `${new Date(entry.expiresAt).toLocaleString("ko-KR")} 만료`}` : " · 무기한"}</small></div><div>{!expired && <a className="text-button" href={entry.url} data-testid={`generator-variants-share-open-${entry.id}`}>열기</a>}<button className="text-button danger-text-button" type="button" data-testid={`generator-variants-share-revoke-${entry.id}`} onClick={() => void revokeSharedVariants(entry)} disabled={sharing}><FiTrash2 /> 공유 취소</button></div></article>; })}</div></details>}
    {localHistory.length > 0 && <details className="generator-variants-local-history" data-testid="generator-variants-local-history"><summary><span>최근 비교 이력</span><small>{localHistory.length}개 저장</small><FiChevronDown /></summary><div>{localHistory.map((entry) => <article key={entry.id}><div><strong>{entry.name}</strong><small>{new Date(entry.createdAt).toLocaleString("ko-KR")}</small></div><div><button className="text-button" type="button" data-testid={`generator-variants-history-open-${entry.id}`} onClick={() => openLocalHistoryEntry(entry)}>불러오기</button><button className="text-button danger-text-button" type="button" data-testid={`generator-variants-history-delete-${entry.id}`} onClick={() => removeLocalHistoryEntry(entry.id)}><FiTrash2 /> 삭제</button></div></article>)}</div></details>}
    {variantImportError && <div className="generator-variant-errors" data-testid="generator-variant-import-error" role="status"><FiAlertTriangle /><div><strong>가져온 비교 결과를 확인하지 못했습니다.</strong><p>{variantImportError}</p></div></div>}
    {variantImportPreview && <section className="generator-preset-import-preview" data-testid="generator-variant-import-preview" aria-label="자동 구성 비교 JSON 미리보기"><div><strong>가져온 비교 결과</strong><span>{variantImportPreview.length}개 구성</span></div><ul>{variantImportPreview.map((item) => <li key={item.priority}>{item.label} · {item.status}{item.totalPriceWon !== undefined ? ` · ${formatWon(item.totalPriceWon)}` : ""}{item.analysisScore !== undefined ? ` · 분석 ${item.analysisScore}점` : ""}{item.error ? ` · ${item.error}` : ""}</li>)}</ul><p><FiInfo /> {variantImportCandidate ? "현재 생성 결과는 바꾸지 않았습니다. 적용하면 가져온 결과를 읽기 전용 비교 상태로 엽니다." : "가져온 파일에 편집기로 가져갈 수 있는 구성 데이터가 없어 미리보기만 표시합니다."}</p><div><button className="text-button" type="button" data-testid="generator-variants-close-import" onClick={() => { setVariantImportPreview(null); setVariantImportCandidate(null); }}>닫기</button>{variantImportCandidate && <button className="button button-primary" type="button" data-testid="generator-variants-apply-import" onClick={applyImportedVariants}>가져온 결과로 비교</button>}</div></section>}
    {importedViewActive && <div className="generator-variant-equivalence" data-testid="generator-variants-imported-state"><FiInfo /><div><strong>가져온 비교 결과를 보고 있습니다.</strong><p>현재 생성 결과는 유지되고, 가져온 JSON의 비교 상태를 읽기 전용으로 표시합니다.</p><button className="text-button generator-variant-equivalence-action" type="button" data-testid="generator-variants-return-current" onClick={returnToCurrentVariants}>현재 생성 결과로 돌아가기</button></div></div>}
    {variants.some((variant) => variant.error) && <div className="generator-variant-errors" role="status"><FiAlertTriangle /><div><strong>일부 기준은 구성을 만들지 못했습니다.</strong>{variants.filter((variant) => variant.error).map((variant) => <p key={variant.priority}>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]} · {variant.error}</p>)}</div></div>}
    {variants.some((variant) => variant.diagnostics && variant.diagnostics.length > 0) && <div className="generator-variant-diagnostics"><strong><FiInfo /> 실패한 기준의 실제 정보</strong>{variants.filter((variant) => variant.diagnostics && variant.diagnostics.length > 0).map((variant) => <article key={variant.priority}><b>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</b>{variant.diagnostics!.slice(0, 1).map((diagnostic) => <div key={diagnostic.id}><strong>{diagnostic.title}</strong><p>{diagnostic.summary}</p>{diagnostic.facts.slice(0, 4).map((fact) => <span key={`${diagnostic.id}-${fact.label}`}>{fact.label} {fact.value}</span>)}</div>)}</article>)}</div>}
    {readyVariants.length > 0 && <>
      {sameConfigurationNotice && <div className="generator-variant-equivalence" data-testid="generator-variant-equivalence-notice"><FiInfo /><div><strong>현재 조건에서는 세 안이 같은 구성입니다.</strong><p>세 안 모두 같은 부품 조합으로 생성됐습니다. 현재 카탈로그에서는 우선순위에 따른 차이가 생기지 않았습니다.</p><small>예산·성능 기준·RAM·저장장치 조건을 바꾸면 다른 구성이 나올 수 있습니다.</small><button className="text-button generator-variant-equivalence-action" type="button" data-testid="generator-variant-adjust-conditions" onClick={adjustConditionsFromImportedVariants}>조건 다시 조정</button></div></div>}
      <GeneratorVariantTradeoffSummary variants={variants} />
      <GeneratorDecisionSummary variants={variants} loading={loading} />
      <div className="generator-variants-table-wrap"><table><caption>우선순위별 자동 구성 비교표</caption><thead><tr><th scope="col">비교 항목</th>{variants.map((variant) => <th scope="col" key={variant.priority}>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${variants[index].priority}`}>{value}</td>)}</tr>)}</tbody></table></div>
      <div className="generator-variant-cards">{variants.map((variant) => variant.draft ? <article className={`generator-variant-card ${variant.draft.status}`} key={variant.priority}><div className="generator-variant-card-top"><span>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}{(configurationCounts.get(generatedVariantSignature(variant.draft)) ?? 0) > 1 && <small>동일 구성</small>}</span><strong>{generatedVariantStatusLabel(variant.draft.status)}</strong></div><div className="generator-variant-card-total"><span>예상 합계</span><strong>{formatWon(variant.draft.totalPriceWon)}</strong><small>{generatedVariantBudgetText(variant.draft)}</small></div>{variant.draft.analysis && <GeneratedAnalysisSummary analysis={variant.draft.analysis} compact />}<div className="generator-variant-card-lines">{["cpu", "gpu", "memory", "ssd", "case", "psu"].map((category) => <div key={category}><span>{CATEGORY_LABELS[category as PartCategory]}</span><strong>{generatedVariantLineText(variant.draft!, category as PartCategory)}</strong></div>)}</div><GeneratorVariantReasons draft={variant.draft} />{variant.draft.warnings.length > 0 && <p className="generator-variant-card-warning"><FiAlertTriangle /> {variant.draft.warnings[0]}</p>}<div className="generator-variant-card-actions"><button className="button button-secondary" type="button" onClick={() => void onApply(variant.draft!, false)} disabled={loading}><FiEdit3 /> 편집기로 가져가기</button><button className="button button-primary" type="button" onClick={() => void onApply(variant.draft!, true)} disabled={loading}><FiActivity /> 바로 검사</button>{onSave && <button className="button button-light generator-variant-save-button" type="button" onClick={() => onSave(variant.draft!)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></article> : <article className="generator-variant-card error" key={variant.priority}><div className="generator-variant-card-top"><span>{RECOMMENDATION_PRIORITY_LABELS[variant.priority]}</span><strong>생성 실패</strong></div><p>{variant.error ?? "이 기준의 초안을 만들지 못했습니다."}</p></article>)}</div>
    </>}
    {readyVariants.length === 0 && !loading && <div className="generator-variant-empty"><FiInfo /><strong>비교할 자동 구성 결과가 없습니다.</strong><p>예산·메모리·저장장치 조건을 완화한 뒤 다시 시도해 주세요.</p></div>}
    <p className="generator-variants-note"><FiInfo /> 세 안 모두 같은 검사 규칙으로 부품을 확인한 결과예요. 표시된 구성은 카탈로그 기준 초안이며 실제 BIOS·QVL·온도·게임 FPS를 보장하지 않아요.</p>
  </section>;
}

function GeneratorBudgetComparisonSummary({ scenarios }: { scenarios: GeneratorBudgetResult[] }) {
  const drafts = scenarios.flatMap((scenario) => scenario.draft ? [{ scenario, draft: scenario.draft }] : []);
  if (drafts.length === 0) return null;
  const configurationCount = new Set(drafts.map(({ draft }) => generatedVariantSignature(draft))).size;
  const prices = drafts.map(({ draft }) => draft.totalPriceWon).filter((value) => Number.isFinite(value));
  const priceMin = prices.length > 0 ? Math.min(...prices) : undefined;
  const priceMax = prices.length > 0 ? Math.max(...prices) : undefined;
  const priceDelta = priceMin !== undefined && priceMax !== undefined ? priceMax - priceMin : undefined;
  const analyses = drafts.flatMap(({ scenario, draft }) => draft.analysis?.overallScore === undefined ? [] : [{ scenario, score: draft.analysis.overallScore }]);
  const analysisMin = analyses.length > 0 ? Math.min(...analyses.map(({ score }) => score)) : undefined;
  const analysisMax = analyses.length > 0 ? Math.max(...analyses.map(({ score }) => score)) : undefined;
  const analysisDelta = analysisMin !== undefined && analysisMax !== undefined ? analysisMax - analysisMin : undefined;
  const changedCategories = PART_CATEGORIES.filter((category) => new Set(drafts.map(({ draft }) => {
    const line = draft.lines.find((item) => item.category === category);
    return `${line?.partId ?? ""}:${line?.quantity ?? 0}`;
  })).size > 1);
  const duplicateGroups = new Map<string, string[]>();
  drafts.forEach(({ scenario, draft }) => {
    const signature = generatedVariantSignature(draft);
    duplicateGroups.set(signature, [...(duplicateGroups.get(signature) ?? []), scenario.label]);
  });
  const repeatedGroups = [...duplicateGroups.values()].filter((group) => group.length > 1);
  const priceText = priceMin === undefined || priceMax === undefined ? "확인 필요" : priceMin === priceMax ? formatWon(priceMin) : `${formatWon(priceMin)} ~ ${formatWon(priceMax)}`;
  const analysisText = analysisMin === undefined || analysisMax === undefined ? "계산 불가" : analysisMin === analysisMax ? `${analysisMin}점` : `${analysisMin}점 ~ ${analysisMax}점`;
  return <section className="generator-budget-comparison-summary" data-testid="generator-budget-comparison-summary" aria-label="예산 구간 비교 결과"><div className="generator-budget-comparison-summary-heading"><div><p className="eyebrow">COMPARISON SUMMARY</p><strong>비교 결과</strong></div><span>{configurationCount}종 구성</span></div><div className="generator-budget-comparison-summary-grid"><article><span>구성</span><strong>{configurationCount}종</strong><small>{drafts.length}개 예산 구간 비교</small></article><article><span>실제 합계</span><strong>{priceText}</strong><small>{priceDelta === undefined || priceDelta === 0 ? "총액 차이 없음" : `가격 차이 ${formatWon(priceDelta)}`}</small></article><article><span>카탈로그 분석</span><strong>{analysisText}</strong><small>{analysisDelta === undefined || analysisDelta === 0 ? "분석 점수 차이 없음" : `점수 차이 ${analysisDelta}점`}</small></article><article><span>부품 변경</span><strong>{changedCategories.length === 0 ? "없음" : `${changedCategories.length}개 항목`}</strong><small>{changedCategories.length === 0 ? "모든 구간의 부품 동일" : changedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")}</small></article></div>{repeatedGroups.length > 0 && <p className="generator-budget-comparison-summary-note"><FiInfo /> 같은 구성: {repeatedGroups.map((group) => group.join(" · ")).join(" / ")}</p>}</section>;
}

function GeneratorBudgetLadderPanel({ scenarios, loading, onApply, onSave, onCopy, onDownload, share, onShare, onRevoke }: { scenarios: GeneratorBudgetResult[]; loading: boolean; onApply: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onSave?: (draft: BuildGenerationResult) => void; onCopy: () => Promise<void>; onDownload: (format: "csv" | "json") => void; share: GeneratorBudgetShareResult | null; onShare: () => void; onRevoke: () => void }) {
  const readyScenarios = scenarios.filter((scenario): scenario is GeneratorBudgetResult & { draft: BuildGenerationResult } => Boolean(scenario.draft));
  const tradeoffs = budgetLadderTradeoffFor(scenarios);
  const frontierCount = tradeoffs.filter((tradeoff) => tradeoff.frontier && tradeoff.riskScore !== undefined).length;
  const budgetDeltaText = (draft: BuildGenerationResult) => draft.withinBudget
    ? `${Math.abs(draft.budgetDeltaWon).toLocaleString("ko-KR")}원 여유`
    : `${draft.budgetDeltaWon.toLocaleString("ko-KR")}원 초과`;
  const budgetChanges = scenarios.slice(1).map((scenario, index) => budgetLadderChangeFor(scenarios[index], scenario)).filter((change): change is NonNullable<typeof change> => Boolean(change));
  const signedWon = (value: number) => value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
  const signedCount = (value: number) => value > 0 ? `+${value}` : String(value);
  const riskDeltaText = (change: NonNullable<typeof budgetChanges[number]>) => change.blockerDelta === 0 && change.warningDelta === 0 && change.unknownDelta === 0
    ? "위험 카운트 변화 없음"
    : `차단 ${signedCount(change.blockerDelta)} · 주의 ${signedCount(change.warningDelta)} · 확인 필요 ${signedCount(change.unknownDelta)}`;
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "상태", values: scenarios.map((scenario) => scenario.draft ? generatedVariantStatusLabel(scenario.draft.status) : "생성 실패") },
    { label: "목표 예산", values: scenarios.map((scenario) => `${scenario.budgetWon.toLocaleString("ko-KR")}원`) },
    { label: "예상 합계", values: scenarios.map((scenario) => scenario.draft ? formatWon(scenario.draft.totalPriceWon) : "-") },
    { label: "예산 여유", values: scenarios.map((scenario) => scenario.draft ? budgetDeltaText(scenario.draft) : "-") },
    { label: "게임 조건", values: scenarios.map((scenario) => scenario.draft ? generatedVariantGamingConditionText(scenario.draft) : "-") },
    { label: "카탈로그 분석", values: scenarios.map((scenario) => scenario.draft ? generatedVariantAnalysisText(scenario.draft) : "-") },
    { label: "CPU", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "cpu") : "-") },
    { label: "GPU", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "gpu") : "-") },
    { label: "RAM", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "memory") : "-") },
    { label: "파워서플라이", values: scenarios.map((scenario) => scenario.draft ? generatedVariantLineText(scenario.draft, "psu") : "-") }
  ];
  return <section className="generator-budget-ladder" aria-label="예산 구간 자동 구성 비교">
    <div className="generator-budget-ladder-heading"><div><p className="eyebrow">BUDGET LADDER</p><h2>예산 구간 3안 비교</h2><p>같은 사용 목적·성능 기준·저장 조건에서 예산만 바꿔, 추가 지출로 어떤 부품과 여유가 달라지는지 확인합니다.</p></div><div className="generator-budget-ladder-heading-actions"><span><FiActivity /> {readyScenarios.length} / {scenarios.length}개 생성 완료</span><div className="generator-budget-ladder-export-actions"><button className="text-button" type="button" onClick={() => void onCopy()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={() => onDownload("csv")}><FiDownload /> CSV 저장</button><button className="text-button" type="button" onClick={() => onDownload("json")}><FiDownload /> JSON 저장</button><button className="text-button" type="button" onClick={onShare}><FiShare2 /> {share ? "링크 다시 만들기" : "공유 링크"}</button></div></div></div>
    {share && <div className="generator-budget-share-preview" role="status"><label><span>예산 비교 공유 링크{share.expiresAt ? ` · ${new Date(share.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="예산 구간 비교 공유 링크" type="text" value={share.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div><a className="text-button" href={share.url}><FiShare2 /> 열기</a><button className="text-button danger-text-button" type="button" onClick={onRevoke}><FiXCircle /> 공유 취소</button></div></div>}
    {scenarios.some((scenario) => scenario.error) && <div className="generator-budget-errors" role="status"><FiAlertTriangle /><div><strong>일부 예산 구간은 구성을 만들지 못했습니다.</strong>{scenarios.filter((scenario) => scenario.error).map((scenario) => <p key={scenario.id}>{scenario.label} · {scenario.error}</p>)}</div></div>}
    {readyScenarios.length > 0 && <>
      <GeneratorBudgetComparisonSummary scenarios={scenarios} />
      <section className="generator-budget-tradeoff" data-testid="generator-budget-tradeoff" aria-label="예산 구간 비교 결과"><div className="generator-budget-tradeoff-heading"><div><strong>비교 결과</strong><span>예산이 늘었는데 구성이 같으면 밀림으로 표시합니다.</span></div><small>{frontierCount}개 구간</small></div><div className="generator-budget-tradeoff-list">{tradeoffs.map((tradeoff, index) => { const scenario = scenarios[index]; return <article className={tradeoff.frontier ? "frontier" : "dominated"} key={scenario.id}><div><span>{tradeoff.frontier ? "비교 대상" : "밀림"}</span><strong>{scenario.label}</strong></div><small>{tradeoff.riskScore === undefined ? "생성 실패" : `남은 위험 ${tradeoff.riskScore}점 · 실제 합계 ${tradeoff.totalPriceWon === undefined ? "확인 필요" : `${tradeoff.totalPriceWon.toLocaleString("ko-KR")}원`} · 분석 ${tradeoff.analysisScore === undefined ? "확인 필요" : `${tradeoff.analysisScore}점`}`}</small><p>{tradeoff.reason}</p></article>; })}</div><p className="generator-budget-tradeoff-note"><FiInfo /> 가격·분석 점수가 확인되지 않은 구간은 순위를 정하지 않아요. 이 표는 예산 선택을 돕는 비교 기준이며 성능 보장이 아닙니다.</p></section>
      <div className="generator-budget-table-wrap"><table><caption>예산별 자동 구성 비교표</caption><thead><tr><th scope="col">비교 항목</th>{scenarios.map((scenario) => <th scope="col" key={scenario.id}>{scenario.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${scenarios[index].id}`}>{value}</td>)}</tr>)}</tbody></table></div>
      {budgetChanges.length > 0 && <section className="generator-budget-deltas" aria-label="예산 증액 효과"><div className="generator-budget-deltas-heading"><div><strong>예산 증액으로 바뀐 것</strong><span>인접한 두 구간의 차이만 계산합니다.</span></div><small>카탈로그 기준 관찰</small></div><div className="generator-budget-delta-list">{budgetChanges.map((change) => <article className={change.sameConfiguration ? "same" : "changed"} key={`${change.fromId}-${change.toId}`}><div className="generator-budget-delta-top"><strong>{change.fromLabel} → {change.toLabel}</strong><span>예산 {signedWon(change.budgetDeltaWon)}</span></div><div className="generator-budget-delta-stats"><span>실제 합계 <b>{signedWon(change.totalPriceDeltaWon)}</b></span><span>{riskDeltaText(change)}</span>{change.analysisScoreDelta !== undefined && <span>분석 점수 <b>{signedCount(change.analysisScoreDelta)}점</b></span>}</div>{change.sameConfiguration ? <p className="generator-budget-delta-same"><FiCheck /> 두 구간의 부품·수량 구성이 같습니다. 예산이 늘어도 현재 카탈로그에서 다른 선택으로 전환되지 않았습니다.</p> : <div className="generator-budget-delta-lines"><span>변경 부품</span>{change.changedLines.map((line) => <p key={line.category}><b>{line.label}</b> {line.before} → {line.after}</p>)}</div>}</article>)}</div><p className="generator-budget-deltas-note"><FiInfo /> 분석 점수와 위험 변화는 현재 카탈로그·호환 규칙 기준입니다. 증액이 실제 FPS나 체감 성능을 보장하지 않으며, 같은 구성이라도 가격·재고는 다시 확인해야 합니다.</p></section>}
      <GeneratorBudgetScoreChart scenarios={scenarios} />
      <div className="generator-budget-cards">{scenarios.map((scenario) => scenario.draft ? <article className={`generator-budget-card ${scenario.draft.status}`} key={scenario.id}><div className="generator-budget-card-top"><div><span>{scenario.label}</span><strong>{scenario.description}</strong></div><em>{generatedVariantStatusLabel(scenario.draft.status)}</em></div><div className="generator-budget-card-total"><div><span>목표 예산</span><strong>{scenario.budgetWon.toLocaleString("ko-KR")}원</strong></div><div><span>예상 합계</span><strong>{formatWon(scenario.draft.totalPriceWon)}</strong><small>{budgetDeltaText(scenario.draft)}</small></div></div><div className="generator-budget-card-lines">{["cpu", "gpu", "memory", "psu"].map((category) => <div key={category}><span>{CATEGORY_LABELS[category as PartCategory]}</span><strong>{generatedVariantLineText(scenario.draft!, category as PartCategory)}</strong></div>)}</div>{scenario.draft.warnings.length > 0 && <p className="generator-budget-card-warning"><FiAlertTriangle /> {scenario.draft.warnings[0]}</p>}<div className="generator-budget-card-actions"><button className="button button-secondary" type="button" onClick={() => void onApply(scenario.draft!, false)} disabled={loading}><FiEdit3 /> 이 안 편집기로</button><button className="button button-primary" type="button" onClick={() => void onApply(scenario.draft!, true)} disabled={loading}><FiActivity /> 바로 검사</button>{onSave && <button className="button button-light" type="button" onClick={() => onSave(scenario.draft!)} disabled={loading}><FiSave /> 새 견적으로 저장</button>}</div></article> : <article className="generator-budget-card error" key={scenario.id}><div className="generator-budget-card-top"><div><span>{scenario.label}</span><strong>{scenario.description}</strong></div><em>생성 실패</em></div><p>{scenario.error ?? "이 예산 구간의 초안을 만들지 못했습니다."}</p><GeneratorBudgetFailureDetails scenario={scenario} /></article>)}</div>
    </>}
    {readyScenarios.length === 0 && !loading && <div className="generator-budget-empty"><FiInfo /><strong>비교할 예산 구간 결과가 없습니다.</strong><p>예산·메모리·저장장치 조건을 확인한 뒤 다시 시도해 주세요.</p></div>}
    <p className="generator-budget-note"><FiInfo /> 예산 구간 비교는 현재 카탈로그 기준의 독립적인 초안 3개를 보여줍니다. 현재 견적은 자동으로 바뀌지 않으며, 원하는 안을 눌렀을 때만 편집기·검사로 이어집니다.</p>
  </section>;
}

function GeneratorBudgetFailureDetails({ scenario }: { scenario: GeneratorBudgetResult }) {
  if (!scenario.diagnostics || scenario.diagnostics.length === 0) return null;
  return <div className="generator-budget-diagnostics"><strong><FiInfo /> 실패한 조건의 실제 정보</strong>{scenario.diagnostics.slice(0, 2).map((diagnostic) => <article key={diagnostic.id}><b>{diagnostic.title}</b><p>{diagnostic.summary}</p><div>{diagnostic.facts.slice(0, 4).map((fact) => <span key={`${diagnostic.id}-${fact.label}`}><em>{fact.label}</em><strong>{fact.value}</strong></span>)}</div>{diagnostic.recommendation && <small>{diagnostic.recommendation}</small>}</article>)}</div>;
}

function GeneratorBudgetScoreChart({ scenarios }: { scenarios: GeneratorBudgetResult[] }) {
  const scoreEntries = scenarios.flatMap((scenario, scenarioIndex) => {
    const score = scenario.draft?.analysis?.overallScore;
    return score === undefined ? [] : [{ scenario, scenarioIndex, score }];
  });
  if (scoreEntries.length === 0) return null;
  const minBudget = Math.min(...scoreEntries.map((entry) => entry.scenario.budgetWon));
  const maxBudget = Math.max(...scoreEntries.map((entry) => entry.scenario.budgetWon));
  const budgetSpan = maxBudget - minBudget;
  const xFor = (entry: (typeof scoreEntries)[number]) => budgetSpan === 0
    ? 16 + (entry.scenarioIndex / Math.max(1, scenarios.length - 1)) * 68
    : 16 + ((entry.scenario.budgetWon - minBudget) / budgetSpan) * 68;
  const yFor = (score: number) => 39 - (Math.max(0, Math.min(100, score)) / 100) * 31;
  const segments: string[] = [];
  let currentSegment: string[] = [];
  scoreEntries.forEach((entry, index) => {
    const previous = scoreEntries[index - 1];
    if (index > 0 && previous.scenarioIndex !== entry.scenarioIndex - 1) {
      if (currentSegment.length > 1) segments.push(currentSegment.join(" "));
      currentSegment = [];
    }
    currentSegment.push(`${xFor(entry)},${yFor(entry.score)}`);
  });
  if (currentSegment.length > 1) segments.push(currentSegment.join(" "));
  return <section className="generator-budget-score-chart" aria-label="예산별 카탈로그 분석 점수 추이"><div className="generator-budget-score-chart-heading"><div><strong>예산별 카탈로그 분석 점수 추이</strong><span>실제 FPS가 아닌 확인 스펙 기반 점수</span></div><small>0–100점</small></div><div className="generator-budget-score-chart-body"><svg viewBox="0 0 100 44" role="img" aria-label="예산별 카탈로그 분석 점수 선 그래프"><title>예산별 카탈로그 분석 점수</title><path d="M16 8H84 M16 23H84 M16 39H84" fill="none" stroke="currentColor" strokeDasharray="1 2" /><text x="2" y="10">100</text><text x="6" y="25">50</text><text x="9" y="41">0</text>{segments.map((segment, index) => <polyline key={`budget-score-segment-${index}`} points={segment} fill="none" vectorEffect="non-scaling-stroke" />)}{scoreEntries.map((entry) => <circle key={`${entry.scenario.id}-score-point`} cx={xFor(entry)} cy={yFor(entry.score)} r="1.7"><title>{entry.scenario.label} · {entry.score}점</title></circle>)}</svg><div className="generator-budget-score-labels">{scenarios.map((scenario) => { const score = scenario.draft?.analysis?.overallScore; return <span key={scenario.id}><b>{scenario.label}</b>{score === undefined ? "분석 불가" : `${score}점`}<small>{scenario.budgetWon.toLocaleString("ko-KR")}원</small></span>; })}</div></div>{scoreEntries.length < scenarios.length && <p className="generator-budget-score-chart-note"><FiInfo /> 분석 점수가 없는 구간은 점을 연결하거나 점수를 추정하지 않았습니다.</p>}</section>;
}
