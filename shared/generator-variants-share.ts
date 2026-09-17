import { parseBuildTransfer } from "./build-transfer";
import { isRecommendationPriority } from "./types";
import type { BuildGenerationRequest, BuildGenerationResult, RecommendationPriority } from "./types";

export const GENERATOR_VARIANTS_EXPORT_TYPE = "pc-supporter-generator-variants" as const;
export const GENERATOR_VARIANTS_EXPORT_VERSION = 1 as const;
export const GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY = "pc-supporter-generator-variants-draft-transfer";

const GENERATOR_VARIANTS_PRIORITIES: RecommendationPriority[] = ["balanced", "budget", "performance"];

export interface GeneratorVariantsExportLine {
  category: string;
  label: string;
  name: string;
  partId?: string;
  quantity: number;
}

export interface GeneratorVariantsExportItem {
  priority: RecommendationPriority;
  label: string;
  status: string;
  error?: string;
  draft?: BuildGenerationResult;
  totalPriceWon?: number;
  budgetDeltaWon?: number;
  analysisScore?: number;
  blockerCount?: number;
  warningCount?: number;
  unknownCount?: number;
  lines?: GeneratorVariantsExportLine[];
}

export interface GeneratorVariantsExportPayload {
  type: typeof GENERATOR_VARIANTS_EXPORT_TYPE;
  version: typeof GENERATOR_VARIANTS_EXPORT_VERSION;
  exportedAt: string;
  items: GeneratorVariantsExportItem[];
}

export interface GeneratorVariantsShareSnapshot {
  id: string;
  name: string;
  payload: GeneratorVariantsExportPayload;
  request?: BuildGenerationRequest;
  catalogSnapshotAt: string;
  catalogCurrentSnapshotAt?: string;
  catalogChangedSinceShare?: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export type SavedGeneratorVariantsRecord = GeneratorVariantsShareSnapshot & {
  ownerTokenHash?: string;
};

export interface GeneratorVariantsShareCreateInput {
  name?: unknown;
  payload?: unknown;
  request?: unknown;
  expiresInDays?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function draftFromUnknown(value: unknown, priority: RecommendationPriority): BuildGenerationResult | undefined {
  if (!isRecord(value) || value.priority !== priority || typeof value.profile !== "string" || typeof value.status !== "string" || !isRecord(value.selection) || !Array.isArray(value.lines) || value.lines.length === 0 || value.lines.length > 10) return undefined;
  const lines = value.lines.map((line) => {
    if (!isRecord(line)) return undefined;
    const category = textValue(line.category, 80);
    const partId = textValue(line.partId, 160);
    const name = textValue(line.name, 240);
    const quantity = typeof line.quantity === "number" && Number.isInteger(line.quantity) && line.quantity >= 0 && line.quantity <= 99 ? line.quantity : undefined;
    const priceWon = finiteNumber(line.priceWon, 0, 100_000_000_000);
    return category && partId && name && quantity !== undefined && priceWon !== undefined ? { ...line, category, partId, name, quantity, priceWon } : undefined;
  });
  if (lines.some((line) => line === undefined)) return undefined;
  const uniqueCategories = new Set(lines.map((line) => line!.category));
  if (uniqueCategories.size !== lines.length) return undefined;
  const cloned = JSON.parse(JSON.stringify(value)) as BuildGenerationResult;
  cloned.lines = lines as BuildGenerationResult["lines"];
  return cloned;
}

function itemLinesFromUnknown(value: unknown): GeneratorVariantsExportLine[] | undefined {
  if (!Array.isArray(value) || value.length > 10) return undefined;
  const lines: Array<GeneratorVariantsExportLine | undefined> = value.map((line): GeneratorVariantsExportLine | undefined => {
    if (!isRecord(line)) return undefined;
    const category = textValue(line.category, 80);
    const label = textValue(line.label, 80);
    const name = textValue(line.name, 240);
    const partId = line.partId === undefined ? undefined : textValue(line.partId, 160);
    if (line.partId !== undefined && !partId) return undefined;
    const quantity = typeof line.quantity === "number" && Number.isInteger(line.quantity) && line.quantity >= 0 && line.quantity <= 99 ? line.quantity : undefined;
    return category && label && name && quantity !== undefined
      ? { category, label, name, ...(partId ? { partId } : {}), quantity }
      : undefined;
  });
  return lines.every((line): line is GeneratorVariantsExportLine => line !== undefined) ? lines : undefined;
}

function itemFromUnknown(value: unknown): GeneratorVariantsExportItem | undefined {
  if (!isRecord(value) || !GENERATOR_VARIANTS_PRIORITIES.includes(value.priority as RecommendationPriority)) return undefined;
  const priority = value.priority as RecommendationPriority;
  const label = textValue(value.label, 120);
  const status = textValue(value.status, 120);
  if (!label || !status) return undefined;
  const error = value.error === undefined ? undefined : textValue(value.error, 500);
  if (value.error !== undefined && !error) return undefined;
  const draft = value.draft === undefined ? undefined : draftFromUnknown(value.draft, priority);
  if (value.draft !== undefined && !draft) return undefined;
  const lines = value.lines === undefined ? undefined : itemLinesFromUnknown(value.lines);
  if (value.lines !== undefined && !lines) return undefined;
  const totalPriceWon = value.totalPriceWon === undefined ? undefined : finiteNumber(value.totalPriceWon, 0, 100_000_000_000);
  const budgetDeltaWon = value.budgetDeltaWon === undefined ? undefined : finiteNumber(value.budgetDeltaWon, -100_000_000_000, 100_000_000_000);
  const analysisScore = value.analysisScore === undefined ? undefined : finiteNumber(value.analysisScore, 0, 100);
  const blockerCount = value.blockerCount === undefined ? undefined : typeof value.blockerCount === "number" && Number.isInteger(value.blockerCount) && value.blockerCount >= 0 && value.blockerCount <= 99 ? value.blockerCount : undefined;
  const warningCount = value.warningCount === undefined ? undefined : typeof value.warningCount === "number" && Number.isInteger(value.warningCount) && value.warningCount >= 0 && value.warningCount <= 99 ? value.warningCount : undefined;
  const unknownCount = value.unknownCount === undefined ? undefined : typeof value.unknownCount === "number" && Number.isInteger(value.unknownCount) && value.unknownCount >= 0 && value.unknownCount <= 99 ? value.unknownCount : undefined;
  if ((value.totalPriceWon !== undefined && totalPriceWon === undefined) || (value.budgetDeltaWon !== undefined && budgetDeltaWon === undefined) || (value.analysisScore !== undefined && analysisScore === undefined) || (value.blockerCount !== undefined && blockerCount === undefined) || (value.warningCount !== undefined && warningCount === undefined) || (value.unknownCount !== undefined && unknownCount === undefined)) return undefined;
  return {
    priority,
    label,
    status,
    ...(error ? { error } : {}),
    ...(draft ? { draft } : {}),
    ...(lines ? { lines } : {}),
    ...(totalPriceWon !== undefined ? { totalPriceWon } : {}),
    ...(budgetDeltaWon !== undefined ? { budgetDeltaWon } : {}),
    ...(analysisScore !== undefined ? { analysisScore } : {}),
    ...(blockerCount !== undefined ? { blockerCount } : {}),
    ...(warningCount !== undefined ? { warningCount } : {}),
    ...(unknownCount !== undefined ? { unknownCount } : {})
  };
}

export function generatorVariantsExportPayloadFromUnknown(value: unknown): GeneratorVariantsExportPayload | undefined {
  if (!isRecord(value) || value.type !== GENERATOR_VARIANTS_EXPORT_TYPE || value.version !== GENERATOR_VARIANTS_EXPORT_VERSION || typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt)) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 3) return undefined;
  const items = value.items.map(itemFromUnknown);
  if (items.some((item) => item === undefined)) return undefined;
  const normalizedItems = items as GeneratorVariantsExportItem[];
  if (new Set(normalizedItems.map((item) => item.priority)).size !== normalizedItems.length) return undefined;
  return { type: GENERATOR_VARIANTS_EXPORT_TYPE, version: GENERATOR_VARIANTS_EXPORT_VERSION, exportedAt: new Date(value.exportedAt).toISOString(), items: normalizedItems };
}

export type GeneratorVariantsDraftTransferMode = "edit" | "check" | "save";

export interface GeneratorVariantsDraftTransferOrigin {
  shareId: string;
  shareName?: string;
  catalogSnapshotAt: string;
  currentRecheckedAt?: string;
}

function generatorVariantsDraftTransferOriginFromUnknown(value: unknown): GeneratorVariantsDraftTransferOrigin | undefined {
  if (!isRecord(value)) return undefined;
  const shareId = textValue(value.shareId, 120);
  const shareName = value.shareName === undefined ? undefined : textValue(value.shareName, 160);
  const catalogSnapshotAt = typeof value.catalogSnapshotAt === "string" && Number.isFinite(Date.parse(value.catalogSnapshotAt)) ? new Date(value.catalogSnapshotAt).toISOString() : undefined;
  const currentRecheckedAt = value.currentRecheckedAt === undefined ? undefined : typeof value.currentRecheckedAt === "string" && Number.isFinite(Date.parse(value.currentRecheckedAt)) ? new Date(value.currentRecheckedAt).toISOString() : undefined;
  if (!shareId || !catalogSnapshotAt || (value.shareName !== undefined && !shareName) || (value.currentRecheckedAt !== undefined && !currentRecheckedAt)) return undefined;
  return { shareId, ...(shareName ? { shareName } : {}), catalogSnapshotAt, ...(currentRecheckedAt ? { currentRecheckedAt } : {}) };
}

/**
 * 공유 화면의 "현재 결과 이어가기"가 sessionStorage에 남긴 draft 전달 봉투를 검증한다.
 * draft.selection은 편집기가 그대로 setBuild·호환 검사·저장에 쓰는 값이므로 견적 JSON
 * 가져오기와 같은 shared/build-transfer.ts 파서로 정규화해 넘긴다.
 */
export function generatorVariantsDraftTransferFromUnknown(value: unknown): { draft: BuildGenerationResult; mode: GeneratorVariantsDraftTransferMode; origin?: GeneratorVariantsDraftTransferOrigin } | undefined {
  if (!isRecord(value)) return undefined;
  const payload = generatorVariantsExportPayloadFromUnknown(value.payload);
  if (!payload || !isRecommendationPriority(value.priority)) return undefined;
  if (value.mode !== "edit" && value.mode !== "check" && value.mode !== "save") return undefined;
  const origin = value.origin === undefined ? undefined : generatorVariantsDraftTransferOriginFromUnknown(value.origin);
  if (value.origin !== undefined && !origin) return undefined;
  const draft = payload.items.find((item) => item.priority === value.priority)?.draft;
  if (!draft) return undefined;
  const parsed = parseBuildTransfer({ selection: draft.selection });
  if (!parsed.envelope) return undefined;
  return { draft: { ...draft, selection: parsed.envelope.selection }, mode: value.mode, ...(origin ? { origin } : {}) };
}

export function generatorVariantsShareExpired(snapshot: Pick<GeneratorVariantsShareSnapshot, "expiresAt">, now = Date.now()) {
  if (!snapshot.expiresAt) return false;
  const timestamp = Date.parse(snapshot.expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

/**
 * Serializes the generation conditions stored with a share into the `/recommend`
 * query contract that BuildGeneratorView's `initialGeneratorParam` readers
 * restore. Parameters the reader does not support are omitted so a shared link
 * never silently lands on different conditions than it advertises.
 */
export function generatorVariantsConditionsSearchFor(request: BuildGenerationRequest): string {
  const params = new URLSearchParams();
  params.set("profile", request.profile);
  if (request.priority === "budget" || request.priority === "performance") params.set("priority", request.priority);
  if (request.performanceTier) params.set("tier", request.performanceTier);
  if (request.profile === "gaming") {
    params.set("resolution", request.gamingResolution ?? "1440p");
    params.set("refresh", String(request.gamingRefreshRate ?? 144));
    if (request.gamingGameIds && request.gamingGameIds.length > 0) params.set("games", request.gamingGameIds.slice(0, 5).join(","));
    if (request.gamingGraphicsPreset) params.set("graphics", request.gamingGraphicsPreset);
    if (request.gamingRayTracing) params.set("rt", "1");
    if (request.gamingUpscaling) params.set("upscaling", request.gamingUpscaling);
  }
  if (request.memoryCapacityGb !== undefined && request.memoryCapacityGb !== 32) params.set("ram", String(request.memoryCapacityGb));
  params.set("budget", String(request.budgetWon));
  if (request.includeGpu === false) params.set("gpu", "0");
  if (request.storageCapacityGb !== undefined && request.storageCapacityGb !== 1000) params.set("ssd", String(request.storageCapacityGb));
  if (request.hddCount !== undefined && request.hddCount > 0) {
    params.set("hdd", String(request.hddCount));
    if (request.hddCapacityGb !== undefined && request.hddCapacityGb !== 4000) params.set("hddCapacity", String(request.hddCapacityGb));
  }
  if (request.listingPolicy && request.listingPolicy !== "retail_only") params.set("listingPolicy", request.listingPolicy);
  return params.toString();
}
