import type { AccessorySelection, BuildGenerationRequest, BuildSelection, PartSelection, RecommendationPreferences } from "../types";
import { isRecommendationPriority } from "../types";
import { BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_M2_SLOTS, BUILD_INPUT_MAX_SELECTIONS_PER_LIST } from "../build-input-limits";

export type BuildParseResult = { build: BuildSelection; errors: string[] };
export type BuildGenerationRequestParseResult = { request?: BuildGenerationRequest; errors: string[] };

const DEFAULT_PREFERENCES: RecommendationPreferences = {
  priority: "balanced",
  profile: "general",
  listingPolicy: "retail_only"
};

const PRIORITIES = ["balanced", "budget", "performance", "reliability"] as const;
const PROFILES = ["general", "gaming", "creator", "development", "office"] as const;
const LISTING_POLICIES = ["retail_only", "include_bulk", "all"] as const;
const PERFORMANCE_TIERS = ["entry", "high", "top"] as const;
const RESOLUTIONS = ["1080p", "1440p", "4k"] as const;
const REFRESH_RATES = [60, 144, 240] as const;
const GRAPHICS_PRESETS = ["competitive", "balanced", "high"] as const;
const UPSCALING_MODES = ["native", "quality", "balanced"] as const;
const GPU_VENDORS = ["nvidia", "amd", "intel"] as const;
const PINNABLE_CATEGORIES = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu"] as const;

export function emptyBuild(): BuildSelection {
  return { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildSelectionLabel(label: string) {
  const match = /^(cpu|cooler|motherboard|memory|gpu|ssd|hdd|case|psu|accessories)(?:\[(\d+)\])?$/.exec(label);
  if (!match) return "부품";
  const labels: Record<string, string> = { cpu: "CPU", cooler: "CPU 쿨러", motherboard: "메인보드", memory: "메모리", gpu: "그래픽카드", ssd: "SSD", hdd: "하드디스크", case: "케이스", psu: "파워", accessories: "주변 부품" };
  const base = labels[match[1]!] ?? "부품";
  return match[2] === undefined ? base : `${base} ${Number(match[2]) + 1}번째`;
}

function parsePartSelection(value: unknown, label: string, errors: string[]): PartSelection | undefined {
  const fieldLabel = buildSelectionLabel(label);
  if (value === undefined || value === null) return undefined;
  if (!record(value)) {
    errors.push(`${fieldLabel} 선택 정보가 올바르지 않습니다.`);
    return undefined;
  }
  const partId = typeof value.partId === "string" ? value.partId.trim() : "";
  if (!partId) {
    errors.push(`${fieldLabel} 선택을 확인해 주세요.`);
    return undefined;
  }
  if (partId.length > BUILD_INPUT_MAX_ID_LENGTH) {
    errors.push(`${fieldLabel} 정보가 너무 깁니다.`);
    return undefined;
  }
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push(`${fieldLabel} 수량은 1~99개로 입력해 주세요.`);
    return undefined;
  }
  return partId && partId.length <= BUILD_INPUT_MAX_ID_LENGTH && Number.isInteger(quantity) && quantity >= 1 && quantity <= 99
    ? { partId, quantity }
    : undefined;
}

function parsePartSelectionList(value: unknown, label: string, errors: string[]): PartSelection[] {
  const fieldLabel = buildSelectionLabel(label);
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${fieldLabel} 목록 형식이 올바르지 않습니다.`);
    return [];
  }
  if (value.length > BUILD_INPUT_MAX_SELECTIONS_PER_LIST) {
    errors.push(`${fieldLabel} 목록은 한 번에 최대 ${BUILD_INPUT_MAX_SELECTIONS_PER_LIST}개까지 선택할 수 있습니다.`);
    return [];
  }
  return value.map((item, index) => parsePartSelection(item, `${label}[${index}]`, errors)).filter((item): item is PartSelection => Boolean(item));
}

function parseAccessorySelection(value: unknown, index: number, errors: string[]): AccessorySelection | undefined {
  const label = `accessories[${index}]`;
  const fieldLabel = buildSelectionLabel(label);
  if (!record(value)) {
    errors.push(`${fieldLabel} 선택 정보가 올바르지 않습니다.`);
    return undefined;
  }
  const accessoryId = typeof value.accessoryId === "string" ? value.accessoryId.trim() : "";
  if (typeof value.accessoryId !== "string" || accessoryId.length === 0) {
    errors.push("주변 부품 선택을 확인해 주세요.");
    return undefined;
  }
  if (accessoryId.length > BUILD_INPUT_MAX_ID_LENGTH) {
    errors.push("주변 부품 정보가 너무 깁니다.");
    return undefined;
  }
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push("주변 부품 수량은 1~99개로 입력해 주세요.");
    return undefined;
  }
  const targetPartId = value.targetPartId;
  if (targetPartId !== undefined && (typeof targetPartId !== "string" || targetPartId.trim().length === 0 || targetPartId.trim().length > BUILD_INPUT_MAX_ID_LENGTH)) {
    errors.push("주변 부품에 연결할 SSD를 확인해 주세요.");
    return undefined;
  }
  const targetAccessoryId = value.targetAccessoryId;
  if (targetAccessoryId !== undefined && (typeof targetAccessoryId !== "string" || targetAccessoryId.trim().length === 0 || targetAccessoryId.trim().length > BUILD_INPUT_MAX_ID_LENGTH)) {
    errors.push("주변 부품에 연결할 팬 허브를 확인해 주세요.");
    return undefined;
  }
  return {
    accessoryId,
    quantity,
    ...(typeof targetPartId === "string" ? { targetPartId: targetPartId.trim() } : {}),
    ...(typeof targetAccessoryId === "string" ? { targetAccessoryId: targetAccessoryId.trim() } : {})
  };
}

function parseAccessorySelectionList(value: unknown, errors: string[]): AccessorySelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${buildSelectionLabel("accessories")} 목록 형식이 올바르지 않습니다.`);
    return [];
  }
  if (value.length > BUILD_INPUT_MAX_SELECTIONS_PER_LIST) {
    errors.push(`${buildSelectionLabel("accessories")} 목록은 한 번에 최대 ${BUILD_INPUT_MAX_SELECTIONS_PER_LIST}개까지 선택할 수 있습니다.`);
    return [];
  }
  return value.map((item, index) => parseAccessorySelection(item, index, errors)).filter((item): item is AccessorySelection => Boolean(item));
}

function normalizeM2SlotId(value: string) {
  const slotNumber = value.trim().toUpperCase().replace(/[ -]/g, "_").match(/^M\.?2_?([1-8])$/)?.[1];
  return slotNumber ? "M2_" + slotNumber : undefined;
}

function parseM2SlotSelection(value: unknown, errors: string[]): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) {
    errors.push("M.2 슬롯별 SSD 선택을 확인해 주세요.");
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > BUILD_INPUT_MAX_M2_SLOTS) {
    errors.push("M.2 슬롯은 최대 " + BUILD_INPUT_MAX_M2_SLOTS + "개까지 지정할 수 있습니다.");
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [rawSlotId, rawPartId] of entries) {
    const slotId = normalizeM2SlotId(rawSlotId);
    if (!slotId) {
      errors.push(`M.2 슬롯 이름 ${rawSlotId}가 올바르지 않습니다. M2_1부터 M2_8까지 사용할 수 있습니다.`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, slotId)) {
      errors.push(`${slotId} 슬롯을 두 번 지정했습니다.`);
      continue;
    }
    if (typeof rawPartId !== "string" || !rawPartId.trim() || rawPartId.trim().length > BUILD_INPUT_MAX_ID_LENGTH) {
      errors.push(`${slotId} 슬롯에 연결할 SSD를 확인해 주세요.`);
      continue;
    }
    normalized[slotId] = rawPartId.trim();
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseBuild(value: unknown): BuildParseResult {
  if (!record(value)) return { build: emptyBuild(), errors: ["견적 본문은 객체여야 합니다."] };
  const errors: string[] = [];
  if (value.useIntegratedGraphics !== undefined && typeof value.useIntegratedGraphics !== "boolean") errors.push("내장 그래픽 설정을 확인해 주세요.");
  if (value.rgbControllerAccessoryId !== undefined && (typeof value.rgbControllerAccessoryId !== "string" || !value.rgbControllerAccessoryId.trim() || value.rgbControllerAccessoryId.trim().length > BUILD_INPUT_MAX_ID_LENGTH)) {
    errors.push("RGB 컨트롤러를 선택해 주세요.");
  }
  const build: BuildSelection = {
    cpu: parsePartSelection(value.cpu, "cpu", errors),
    cooler: parsePartSelection(value.cooler, "cooler", errors),
    motherboard: parsePartSelection(value.motherboard, "motherboard", errors),
    memory: parsePartSelectionList(value.memory, "memory", errors),
    gpu: parsePartSelection(value.gpu, "gpu", errors),
    ssd: parsePartSelectionList(value.ssd, "ssd", errors),
    hdd: parsePartSelectionList(value.hdd, "hdd", errors),
    case: parsePartSelection(value.case, "case", errors),
    psu: parsePartSelection(value.psu, "psu", errors),
    accessories: parseAccessorySelectionList(value.accessories, errors),
    m2SlotSelection: parseM2SlotSelection(value.m2SlotSelection, errors),
    ...(typeof value.rgbControllerAccessoryId === "string" && value.rgbControllerAccessoryId.trim()
      ? { rgbControllerAccessoryId: value.rgbControllerAccessoryId.trim() }
      : {}),
    useIntegratedGraphics: value.useIntegratedGraphics !== false
  };
  return { build, errors };
}

export function parseRecommendationPreferences(value: unknown): RecommendationPreferences {
  if (!record(value)) return { ...DEFAULT_PREFERENCES };
  const profile = PROFILES.includes(value.profile as typeof PROFILES[number]) ? value.profile as RecommendationPreferences["profile"] : DEFAULT_PREFERENCES.profile;
  const priority = isRecommendationPriority(value.priority) ? value.priority : DEFAULT_PREFERENCES.priority;
  const listingPolicy = LISTING_POLICIES.includes(value.listingPolicy as typeof LISTING_POLICIES[number]) ? value.listingPolicy as RecommendationPreferences["listingPolicy"] : DEFAULT_PREFERENCES.listingPolicy;
  const rawBudget = Number(value.budgetWon);
  const budgetWon = Number.isSafeInteger(rawBudget) && rawBudget > 0 && rawBudget <= 100_000_000 ? rawBudget : undefined;
  const performanceTier = PERFORMANCE_TIERS.includes(value.performanceTier as typeof PERFORMANCE_TIERS[number]) ? value.performanceTier as RecommendationPreferences["performanceTier"] : undefined;
  const gamingResolution = RESOLUTIONS.includes(value.gamingResolution as typeof RESOLUTIONS[number]) ? value.gamingResolution as RecommendationPreferences["gamingResolution"] : undefined;
  const gamingRefreshRate = REFRESH_RATES.includes(Number(value.gamingRefreshRate) as typeof REFRESH_RATES[number]) ? Number(value.gamingRefreshRate) as RecommendationPreferences["gamingRefreshRate"] : undefined;
  const gamingGameIds = Array.isArray(value.gamingGameIds) ? value.gamingGameIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.trim().length <= BUILD_INPUT_MAX_ID_LENGTH).slice(0, 5) : undefined;
  const gamingGraphicsPreset = GRAPHICS_PRESETS.includes(value.gamingGraphicsPreset as typeof GRAPHICS_PRESETS[number]) ? value.gamingGraphicsPreset as RecommendationPreferences["gamingGraphicsPreset"] : undefined;
  const gamingRayTracing = typeof value.gamingRayTracing === "boolean" ? value.gamingRayTracing : undefined;
  const gamingUpscaling = UPSCALING_MODES.includes(value.gamingUpscaling as typeof UPSCALING_MODES[number]) ? value.gamingUpscaling as RecommendationPreferences["gamingUpscaling"] : undefined;
  return {
    priority,
    profile,
    ...(budgetWon === undefined ? {} : { budgetWon }),
    listingPolicy,
    ...(performanceTier ? { performanceTier } : {}),
    ...(gamingResolution ? { gamingResolution } : {}),
    ...(profile === "gaming" && gamingRefreshRate ? { gamingRefreshRate } : {}),
    ...(profile === "gaming" && gamingGameIds?.length ? { gamingGameIds } : {}),
    ...(profile === "gaming" && gamingGraphicsPreset ? { gamingGraphicsPreset } : {}),
    ...(profile === "gaming" && gamingRayTracing !== undefined ? { gamingRayTracing } : {}),
    ...(profile === "gaming" && gamingUpscaling ? { gamingUpscaling } : {})
  };
}

export function parseBuildGenerationRequest(value: unknown): BuildGenerationRequestParseResult {
  if (!record(value)) return { errors: ["자동 견적 요청은 객체여야 합니다."] };
  const errors: string[] = [];
  const profile = PROFILES.includes(value.profile as typeof PROFILES[number]) ? value.profile as RecommendationPreferences["profile"] : "general";
  const priority = isRecommendationPriority(value.priority) ? value.priority : "balanced";
  const budgetWon = Number(value.budgetWon);
  if (!Number.isFinite(budgetWon) || !Number.isInteger(budgetWon) || budgetWon <= 0 || budgetWon > 100_000_000) errors.push("budgetWon은 1원부터 100,000,000원 사이의 정수여야 합니다.");
  if (value.includeGpu !== undefined && typeof value.includeGpu !== "boolean") errors.push("includeGpu는 boolean이어야 합니다.");
  if (value.priority !== undefined && !isRecommendationPriority(value.priority)) errors.push("priority는 balanced, budget, performance, reliability 중 하나여야 합니다.");
  if (value.performanceTier !== undefined && !PERFORMANCE_TIERS.includes(value.performanceTier as typeof PERFORMANCE_TIERS[number])) errors.push("performanceTier는 entry, high, top 중 하나여야 합니다.");
  if (value.includeNonRetail !== undefined && typeof value.includeNonRetail !== "boolean") errors.push("includeNonRetail은 boolean이어야 합니다.");
  if (value.gamingResolution !== undefined && !RESOLUTIONS.includes(value.gamingResolution as typeof RESOLUTIONS[number])) errors.push("gamingResolution은 1080p, 1440p, 4k 중 하나여야 합니다.");
  if (value.gamingRefreshRate !== undefined && !REFRESH_RATES.includes(Number(value.gamingRefreshRate) as typeof REFRESH_RATES[number])) errors.push("gamingRefreshRate는 60, 144, 240 중 하나여야 합니다.");
  if (value.gamingGameIds !== undefined && (!Array.isArray(value.gamingGameIds) || value.gamingGameIds.length > 5 || !value.gamingGameIds.every((id) => typeof id === "string" && id.trim().length > 0 && id.trim().length <= BUILD_INPUT_MAX_ID_LENGTH))) errors.push("gamingGameIds는 최대 5개의 비어 있지 않은 160자 이하 게임 ID 배열이어야 합니다.");
  if (value.gamingGraphicsPreset !== undefined && !GRAPHICS_PRESETS.includes(value.gamingGraphicsPreset as typeof GRAPHICS_PRESETS[number])) errors.push("gamingGraphicsPreset은 competitive, balanced, high 중 하나여야 합니다.");
  if (value.gamingRayTracing !== undefined && typeof value.gamingRayTracing !== "boolean") errors.push("gamingRayTracing은 boolean이어야 합니다.");
  if (value.gamingUpscaling !== undefined && !UPSCALING_MODES.includes(value.gamingUpscaling as typeof UPSCALING_MODES[number])) errors.push("gamingUpscaling은 native, quality, balanced 중 하나여야 합니다.");
  const memoryCapacityGb = Number(value.memoryCapacityGb ?? 32);
  if (![16, 32, 64, 128].includes(memoryCapacityGb)) errors.push("memoryCapacityGb는 16, 32, 64, 128 중 하나여야 합니다.");
  const listingPolicyRaw = value.listingPolicy === undefined ? (value.includeNonRetail === true ? "all" : "retail_only") : String(value.listingPolicy);
  if (!LISTING_POLICIES.includes(listingPolicyRaw as typeof LISTING_POLICIES[number])) errors.push("listingPolicy는 retail_only, include_bulk, all 중 하나여야 합니다.");
  const storageCapacityGb = Number(value.storageCapacityGb ?? 1000);
  if (!Number.isInteger(storageCapacityGb) || storageCapacityGb <= 0 || storageCapacityGb > 100_000) errors.push("storageCapacityGb는 1부터 100,000 사이의 정수여야 합니다.");
  const hddCount = Number(value.hddCount ?? 0);
  if (!Number.isInteger(hddCount) || hddCount < 0 || hddCount > 8) errors.push("hddCount는 0부터 8 사이의 정수여야 합니다.");
  const hddCapacityGb = Number(value.hddCapacityGb ?? 4000);
  if (!Number.isInteger(hddCapacityGb) || hddCapacityGb <= 0 || hddCapacityGb > 100_000) errors.push("hddCapacityGb는 1부터 100,000 사이의 정수여야 합니다.");
  if (value.gpuVendorPreference !== undefined && !GPU_VENDORS.includes(value.gpuVendorPreference as typeof GPU_VENDORS[number])) errors.push("gpuVendorPreference는 nvidia, amd, intel 중 하나여야 합니다.");
  let pinnedParts: BuildGenerationRequest["pinnedParts"];
  if (value.pinnedParts !== undefined) {
    if (!record(value.pinnedParts)) {
      errors.push("pinnedParts는 카테고리별 부품 ID 객체여야 합니다.");
    } else {
      pinnedParts = {};
      for (const [category, partId] of Object.entries(value.pinnedParts)) {
        if (!PINNABLE_CATEGORIES.includes(category as typeof PINNABLE_CATEGORIES[number])) {
          errors.push(`pinnedParts 카테고리 '${category}'는 지원하지 않습니다.`);
          continue;
        }
        if (typeof partId !== "string" || partId.trim().length === 0 || partId.trim().length > BUILD_INPUT_MAX_ID_LENGTH) {
          errors.push(`pinnedParts.${category}는 비어 있지 않은 ${BUILD_INPUT_MAX_ID_LENGTH}자 이하 부품 ID여야 합니다.`);
          continue;
        }
        pinnedParts[category as typeof PINNABLE_CATEGORIES[number]] = partId.trim();
      }
    }
  }
  if (errors.length > 0) return { errors };
  return {
    request: {
      profile,
      budgetWon,
      includeGpu: typeof value.includeGpu === "boolean" ? value.includeGpu : profile === "gaming",
      priority,
      ...(typeof value.performanceTier === "string" ? { performanceTier: value.performanceTier as BuildGenerationRequest["performanceTier"] } : {}),
      gamingResolution: RESOLUTIONS.includes(value.gamingResolution as typeof RESOLUTIONS[number]) ? value.gamingResolution as BuildGenerationRequest["gamingResolution"] : "1440p",
      gamingRefreshRate: REFRESH_RATES.includes(Number(value.gamingRefreshRate) as typeof REFRESH_RATES[number]) ? Number(value.gamingRefreshRate) as BuildGenerationRequest["gamingRefreshRate"] : 144,
      ...(Array.isArray(value.gamingGameIds) ? { gamingGameIds: value.gamingGameIds as string[] } : {}),
      ...(typeof value.gamingGraphicsPreset === "string" ? { gamingGraphicsPreset: value.gamingGraphicsPreset as BuildGenerationRequest["gamingGraphicsPreset"] } : {}),
      ...(typeof value.gamingRayTracing === "boolean" ? { gamingRayTracing: value.gamingRayTracing } : {}),
      ...(typeof value.gamingUpscaling === "string" ? { gamingUpscaling: value.gamingUpscaling as BuildGenerationRequest["gamingUpscaling"] } : {}),
      memoryCapacityGb,
      storageCapacityGb,
      hddCapacityGb,
      hddCount,
      includeNonRetail: listingPolicyRaw === "all",
      listingPolicy: listingPolicyRaw as BuildGenerationRequest["listingPolicy"],
      ...(pinnedParts !== undefined && Object.keys(pinnedParts).length > 0 ? { pinnedParts } : {}),
      ...(GPU_VENDORS.includes(value.gpuVendorPreference as typeof GPU_VENDORS[number]) ? { gpuVendorPreference: value.gpuVendorPreference as BuildGenerationRequest["gpuVendorPreference"] } : {})
    },
    errors: []
  };
}
