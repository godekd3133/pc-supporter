import type { AccessorySelection, BuildSelection, PartSelection, RecommendationPreferences } from "./types";

export const BUILD_TRANSFER_SCHEMA_VERSION = 1 as const;

export interface BuildTransferEnvelope {
  schemaVersion: typeof BUILD_TRANSFER_SCHEMA_VERSION;
  exportedAt: string;
  selection: BuildSelection;
  recommendationPreferences: RecommendationPreferences;
}

export interface BuildTransferParseResult {
  envelope?: BuildTransferEnvelope;
  errors: string[];
}

const defaultPreferences: RecommendationPreferences = {
  priority: "balanced",
  profile: "general",
  listingPolicy: "retail_only",
  gamingResolution: "1440p"
};

const selectionKeys = ["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu", "accessories", "m2SlotSelection", "useIntegratedGraphics"] as const;

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function selectionFromUnknown(value: unknown, path: string, errors: string[]): PartSelection | undefined {
  if (value === undefined) return undefined;
  const record = recordFromUnknown(value);
  if (!record) {
    errors.push(`${path}는 객체여야 합니다.`);
    return undefined;
  }
  const partId = typeof record.partId === "string" ? record.partId.trim() : "";
  if (!partId) errors.push(`${path}.partId가 필요합니다.`);
  const quantity = record.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) errors.push(`${path}.quantity는 1부터 99 사이의 정수여야 합니다.`);
  return partId && typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? { partId, quantity } : undefined;
}

function selectionListFromUnknown(value: unknown, path: string, errors: string[]): PartSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path}는 배열이어야 합니다.`);
    return [];
  }
  return value.map((item, index) => selectionFromUnknown(item, `${path}[${index}]`, errors)).filter((item): item is PartSelection => Boolean(item));
}

function accessoryListFromUnknown(value: unknown, errors: string[]): AccessorySelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("selection.accessories는 배열이어야 합니다.");
    return [];
  }
  return value.map((item, index) => {
    const record = recordFromUnknown(item);
    const rawTargetPartId = record?.targetPartId;
    const targetPartId = typeof rawTargetPartId === "string" && rawTargetPartId.trim().length > 0 ? rawTargetPartId.trim() : undefined;
    if (rawTargetPartId !== undefined && targetPartId === undefined) errors.push(`selection.accessories[${index}].targetPartId는 비어 있지 않은 SSD ID여야 합니다.`);
    const rawTargetAccessoryId = record?.targetAccessoryId;
    const targetAccessoryId = typeof rawTargetAccessoryId === "string" && rawTargetAccessoryId.trim().length > 0 ? rawTargetAccessoryId.trim() : undefined;
    if (rawTargetAccessoryId !== undefined && targetAccessoryId === undefined) errors.push(`selection.accessories[${index}].targetAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.`);
    const parsed = selectionFromUnknown(record ? { partId: record.accessoryId, quantity: record.quantity } : item, `selection.accessories[${index}]`, errors);
    return parsed ? { accessoryId: parsed.partId, quantity: parsed.quantity, ...(targetPartId ? { targetPartId } : {}), ...(targetAccessoryId ? { targetAccessoryId } : {}) } : undefined;
  }).filter((item): item is AccessorySelection => Boolean(item));
}

function m2SlotSelectionFromUnknown(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  const record = recordFromUnknown(value);
  if (!record) {
    errors.push("selection.m2SlotSelection은 객체여야 합니다.");
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [rawSlotId, rawPartId] of Object.entries(record)) {
    const slotId = rawSlotId.trim().toUpperCase().replaceAll(" ", "_");
    if (!/^M2_[1-8]$/.test(slotId)) {
      errors.push(`selection.m2SlotSelection의 슬롯 ID ${rawSlotId}가 M2_1부터 M2_8 형식이 아닙니다.`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, slotId)) {
      errors.push(`${slotId} 슬롯이 중복되었습니다.`);
      continue;
    }
    if (typeof rawPartId !== "string" || !rawPartId.trim()) {
      errors.push(`${slotId}의 SSD ID가 필요합니다.`);
      continue;
    }
    normalized[slotId] = rawPartId.trim();
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function recommendationPreferencesFromUnknown(value: unknown, errors: string[]): RecommendationPreferences {
  if (value === undefined) return defaultPreferences;
  const record = recordFromUnknown(value);
  if (!record) {
    errors.push("recommendationPreferences는 객체여야 합니다.");
    return defaultPreferences;
  }
  const priority = record.priority;
  const profile = record.profile;
  const listingPolicy = record.listingPolicy;
  const gamingResolution = record.gamingResolution;
  const gamingRefreshRate = record.gamingRefreshRate;
  if (priority !== undefined && priority !== "balanced" && priority !== "budget" && priority !== "performance") errors.push("recommendationPreferences.priority가 올바르지 않습니다.");
  if (profile !== undefined && profile !== "general" && profile !== "gaming" && profile !== "creator" && profile !== "development" && profile !== "office") errors.push("recommendationPreferences.profile이 올바르지 않습니다.");
  if (listingPolicy !== undefined && listingPolicy !== "retail_only" && listingPolicy !== "include_bulk" && listingPolicy !== "all") errors.push("recommendationPreferences.listingPolicy가 올바르지 않습니다.");
  if (gamingResolution !== undefined && gamingResolution !== "1080p" && gamingResolution !== "1440p" && gamingResolution !== "4k") errors.push("recommendationPreferences.gamingResolution이 올바르지 않습니다.");
  if (gamingRefreshRate !== undefined && gamingRefreshRate !== 60 && gamingRefreshRate !== 144 && gamingRefreshRate !== 240) errors.push("recommendationPreferences.gamingRefreshRate가 올바르지 않습니다.");
  const budget = record.budgetWon;
  if (budget !== undefined && (typeof budget !== "number" || !Number.isInteger(budget) || budget <= 0 || budget > 100_000_000)) errors.push("recommendationPreferences.budgetWon은 1부터 100,000,000 사이의 정수여야 합니다.");
  const parsedProfile = profile === "general" || profile === "gaming" || profile === "creator" || profile === "development" || profile === "office" ? profile : defaultPreferences.profile;
  return {
    priority: priority === "balanced" || priority === "budget" || priority === "performance" ? priority : defaultPreferences.priority,
    profile: parsedProfile,
    listingPolicy: listingPolicy === "retail_only" || listingPolicy === "include_bulk" || listingPolicy === "all" ? listingPolicy : defaultPreferences.listingPolicy,
    ...(typeof budget === "number" && Number.isInteger(budget) && budget > 0 && budget <= 100_000_000 ? { budgetWon: budget } : {}),
    gamingResolution: gamingResolution === "1080p" || gamingResolution === "1440p" || gamingResolution === "4k" ? gamingResolution : defaultPreferences.gamingResolution,
    ...(parsedProfile === "gaming" ? { gamingRefreshRate: gamingRefreshRate === 60 || gamingRefreshRate === 144 || gamingRefreshRate === 240 ? gamingRefreshRate : 144 as const } : {})
  };
}

export function buildTransferJsonFor(selection: BuildSelection, recommendationPreferences: RecommendationPreferences) {
  const envelope: BuildTransferEnvelope = {
    schemaVersion: BUILD_TRANSFER_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    selection,
    recommendationPreferences
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseBuildTransfer(input: unknown): BuildTransferParseResult {
  let value: unknown = input;
  const errors: string[] = [];
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { errors: ["견적 JSON 형식이 올바르지 않습니다."] };
    }
  }
  const root = recordFromUnknown(value);
  if (!root) return { errors: ["견적 JSON은 객체여야 합니다."] };
  if (root.schemaVersion !== undefined && root.schemaVersion !== BUILD_TRANSFER_SCHEMA_VERSION) errors.push(`지원하지 않는 견적 JSON schemaVersion입니다: ${String(root.schemaVersion)}`);
  const rawSelection = root.selection ?? root.build ?? (selectionKeys.some((key) => Object.prototype.hasOwnProperty.call(root, key)) ? root : undefined);
  const selectionRecord = recordFromUnknown(rawSelection);
  if (!selectionRecord) {
    errors.push("selection 객체가 필요합니다.");
  }
  const source = selectionRecord ?? {};
  const useIntegratedGraphics = source.useIntegratedGraphics;
  if (useIntegratedGraphics !== undefined && typeof useIntegratedGraphics !== "boolean") errors.push("selection.useIntegratedGraphics는 boolean이어야 합니다.");
  const rawRgbControllerAccessoryId = source.rgbControllerAccessoryId;
  const rgbControllerAccessoryId = typeof rawRgbControllerAccessoryId === "string" && rawRgbControllerAccessoryId.trim().length > 0 ? rawRgbControllerAccessoryId.trim() : undefined;
  if (rawRgbControllerAccessoryId !== undefined && rgbControllerAccessoryId === undefined) errors.push("selection.rgbControllerAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.");
  const selection: BuildSelection = {
    cpu: selectionFromUnknown(source.cpu, "selection.cpu", errors),
    cooler: selectionFromUnknown(source.cooler, "selection.cooler", errors),
    motherboard: selectionFromUnknown(source.motherboard, "selection.motherboard", errors),
    memory: selectionListFromUnknown(source.memory, "selection.memory", errors),
    gpu: selectionFromUnknown(source.gpu, "selection.gpu", errors),
    ssd: selectionListFromUnknown(source.ssd, "selection.ssd", errors),
    hdd: selectionListFromUnknown(source.hdd, "selection.hdd", errors),
    case: selectionFromUnknown(source.case, "selection.case", errors),
    psu: selectionFromUnknown(source.psu, "selection.psu", errors),
    accessories: accessoryListFromUnknown(source.accessories, errors),
    m2SlotSelection: m2SlotSelectionFromUnknown(source.m2SlotSelection, errors),
    ...(rgbControllerAccessoryId ? { rgbControllerAccessoryId } : {}),
    useIntegratedGraphics: useIntegratedGraphics !== false
  };
  const recommendationPreferences = recommendationPreferencesFromUnknown(root.recommendationPreferences, errors);
  if (errors.length > 0) return { errors };
  return {
    envelope: {
      schemaVersion: BUILD_TRANSFER_SCHEMA_VERSION,
      exportedAt: typeof root.exportedAt === "string" && Number.isFinite(Date.parse(root.exportedAt)) ? root.exportedAt : new Date(0).toISOString(),
      selection,
      recommendationPreferences
    },
    errors: []
  };
}
