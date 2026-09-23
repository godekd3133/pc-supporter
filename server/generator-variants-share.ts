import type { BuildGenerationRequest, GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling, ListingPolicy, RecommendationPerformanceTier, RecommendationPriority, RecommendationProfile } from "../shared/types";
import { generatorVariantsExportPayloadFromUnknown, type GeneratorVariantsExportPayload, type GeneratorVariantsShareCreateInput, type GeneratorVariantsShareSnapshot, type SavedGeneratorVariantsRecord } from "../shared/generator-variants-share";
import { shareExpiresAtFor, shareExpired, shareExpiryDaysFrom, shareExpiryValueProvided } from "./share-lifecycle";

const MAX_NAME_LENGTH = 160;
const MAX_PAYLOAD_BYTES = 1_000_000;
const PROFILES: RecommendationProfile[] = ["general", "gaming", "creator", "development", "office"];
const REQUEST_PRIORITIES: RecommendationPriority[] = ["balanced", "budget", "performance", "reliability"];
const PERFORMANCE_TIERS: RecommendationPerformanceTier[] = ["entry", "high", "top"];
const GRAPHICS_PRESETS: GamingGraphicsPreset[] = ["competitive", "balanced", "high"];
const UPSCALINGS: GamingUpscaling[] = ["native", "quality", "balanced"];
const RESOLUTIONS: GamingResolution[] = ["1080p", "1440p", "4k"];
const REFRESH_RATES: GamingRefreshRate[] = [60, 144, 240];
const LISTING_POLICIES: ListingPolicy[] = ["retail_only", "include_bulk", "all"];

export interface GeneratorVariantsShareInputResult {
  name?: string;
  payload?: GeneratorVariantsExportPayload;
  request?: BuildGenerationRequest;
  expiresInDays?: 7 | 30;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function requestFromUnknown(value: unknown): BuildGenerationRequest | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const profile = PROFILES.includes(value.profile as RecommendationProfile) ? value.profile as RecommendationProfile : undefined;
  const budgetWon = typeof value.budgetWon === "number" && Number.isInteger(value.budgetWon) && value.budgetWon > 0 && value.budgetWon <= 100_000_000 ? value.budgetWon : undefined;
  const includeGpu = typeof value.includeGpu === "boolean" ? value.includeGpu : undefined;
  if (!profile || budgetWon === undefined || includeGpu === undefined) return undefined;
  const priority = value.priority === undefined ? undefined : REQUEST_PRIORITIES.includes(value.priority as RecommendationPriority) ? value.priority as RecommendationPriority : undefined;
  const performanceTier = value.performanceTier === undefined ? undefined : PERFORMANCE_TIERS.includes(value.performanceTier as RecommendationPerformanceTier) ? value.performanceTier as RecommendationPerformanceTier : undefined;
  const gamingResolution = value.gamingResolution === undefined ? undefined : RESOLUTIONS.includes(value.gamingResolution as GamingResolution) ? value.gamingResolution as GamingResolution : undefined;
  const gamingRefreshRate = value.gamingRefreshRate === undefined ? undefined : REFRESH_RATES.includes(Number(value.gamingRefreshRate) as GamingRefreshRate) ? Number(value.gamingRefreshRate) as GamingRefreshRate : undefined;
  const gamingGameIds = value.gamingGameIds === undefined ? undefined : Array.isArray(value.gamingGameIds) && value.gamingGameIds.length <= 5 && value.gamingGameIds.every((id) => typeof id === "string" && id.trim().length > 0 && id.trim().length <= 160) ? value.gamingGameIds.map((id) => (id as string).trim()) : undefined;
  const gamingGraphicsPreset = value.gamingGraphicsPreset === undefined ? undefined : GRAPHICS_PRESETS.includes(value.gamingGraphicsPreset as GamingGraphicsPreset) ? value.gamingGraphicsPreset as GamingGraphicsPreset : undefined;
  const gamingRayTracing = value.gamingRayTracing === undefined ? undefined : typeof value.gamingRayTracing === "boolean" ? value.gamingRayTracing : undefined;
  const gamingUpscaling = value.gamingUpscaling === undefined ? undefined : UPSCALINGS.includes(value.gamingUpscaling as GamingUpscaling) ? value.gamingUpscaling as GamingUpscaling : undefined;
  const memoryCapacityGb = value.memoryCapacityGb === undefined ? undefined : [16, 32, 64, 128].includes(Number(value.memoryCapacityGb)) ? Number(value.memoryCapacityGb) : undefined;
  const storageCapacityGb = value.storageCapacityGb === undefined ? undefined : typeof value.storageCapacityGb === "number" && Number.isInteger(value.storageCapacityGb) && value.storageCapacityGb > 0 && value.storageCapacityGb <= 100_000 ? value.storageCapacityGb : undefined;
  const hddCapacityGb = value.hddCapacityGb === undefined ? undefined : typeof value.hddCapacityGb === "number" && Number.isInteger(value.hddCapacityGb) && value.hddCapacityGb > 0 && value.hddCapacityGb <= 100_000 ? value.hddCapacityGb : undefined;
  const hddCount = value.hddCount === undefined ? undefined : typeof value.hddCount === "number" && Number.isInteger(value.hddCount) && value.hddCount >= 0 && value.hddCount <= 8 ? value.hddCount : undefined;
  const includeNonRetail = value.includeNonRetail === undefined ? undefined : typeof value.includeNonRetail === "boolean" ? value.includeNonRetail : undefined;
  const listingPolicy = value.listingPolicy === undefined ? undefined : LISTING_POLICIES.includes(value.listingPolicy as ListingPolicy) ? value.listingPolicy as ListingPolicy : undefined;
  if ((value.priority !== undefined && priority === undefined) || (value.performanceTier !== undefined && performanceTier === undefined) || (value.gamingResolution !== undefined && gamingResolution === undefined) || (value.gamingRefreshRate !== undefined && gamingRefreshRate === undefined) || (value.gamingGameIds !== undefined && gamingGameIds === undefined) || (value.gamingGraphicsPreset !== undefined && gamingGraphicsPreset === undefined) || (value.gamingRayTracing !== undefined && gamingRayTracing === undefined) || (value.gamingUpscaling !== undefined && gamingUpscaling === undefined) || (value.memoryCapacityGb !== undefined && memoryCapacityGb === undefined) || (value.storageCapacityGb !== undefined && storageCapacityGb === undefined) || (value.hddCapacityGb !== undefined && hddCapacityGb === undefined) || (value.hddCount !== undefined && hddCount === undefined) || (value.includeNonRetail !== undefined && includeNonRetail === undefined) || (value.listingPolicy !== undefined && listingPolicy === undefined)) return undefined;
  return { profile, budgetWon, includeGpu, ...(priority ? { priority } : {}), ...(performanceTier ? { performanceTier } : {}), ...(gamingResolution ? { gamingResolution } : {}), ...(gamingRefreshRate ? { gamingRefreshRate } : {}), ...(gamingGameIds && gamingGameIds.length > 0 ? { gamingGameIds } : {}), ...(gamingGraphicsPreset ? { gamingGraphicsPreset } : {}), ...(gamingRayTracing !== undefined ? { gamingRayTracing } : {}), ...(gamingUpscaling ? { gamingUpscaling } : {}), ...(memoryCapacityGb ? { memoryCapacityGb } : {}), ...(storageCapacityGb ? { storageCapacityGb } : {}), ...(hddCapacityGb ? { hddCapacityGb } : {}), ...(hddCount !== undefined ? { hddCount } : {}), ...(includeNonRetail !== undefined ? { includeNonRetail } : {}), ...(listingPolicy ? { listingPolicy } : {}) };
}

export function parseGeneratorVariantsShareInput(input: GeneratorVariantsShareCreateInput): GeneratorVariantsShareInputResult {
  const errors: string[] = [];
  const name = textValue(input?.name, MAX_NAME_LENGTH);
  if (!name) errors.push("자동 구성 비교 이름이 필요합니다.");
  let payload: GeneratorVariantsExportPayload | undefined;
  if (!isRecord(input) || input.payload === undefined) {
    errors.push("자동 구성 비교 파일을 확인해 주세요.");
  } else {
    const serialized = JSON.stringify(input.payload);
    if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) errors.push("자동 구성 비교 파일이 너무 큽니다.");
    payload = generatorVariantsExportPayloadFromUnknown(input.payload);
    if (!payload) errors.push("자동 구성 비교 결과를 읽지 못했어요. 다시 만들어 주세요.");
  }
  const expiresInDays = shareExpiryDaysFrom(input?.expiresInDays);
  if (shareExpiryValueProvided(input?.expiresInDays) && expiresInDays === undefined) errors.push("공유 만료 기간은 7일 또는 30일이어야 합니다.");
  const request = input?.request === undefined ? undefined : requestFromUnknown(input.request);
  if (input?.request !== undefined && !request) errors.push("자동 구성 비교 생성 조건 형식이 올바르지 않습니다.");
  return { ...(name ? { name } : {}), ...(payload ? { payload } : {}), ...(request ? { request } : {}), ...(expiresInDays ? { expiresInDays } : {}), errors };
}

export function savedGeneratorVariantsFromUnknown(value: unknown): SavedGeneratorVariantsRecord | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim() || typeof value.catalogSnapshotAt !== "string" || !Number.isFinite(Date.parse(value.catalogSnapshotAt)) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return undefined;
  const payload = generatorVariantsExportPayloadFromUnknown(value.payload);
  if (!payload) return undefined;
  const request = value.request === undefined ? undefined : requestFromUnknown(value.request);
  if (value.request !== undefined && !request) return undefined;
  const expiresAt = value.expiresAt === undefined ? undefined : typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) ? new Date(value.expiresAt).toISOString() : undefined;
  if (value.expiresAt !== undefined && !expiresAt) return undefined;
  const ownerTokenHash = value.ownerTokenHash === undefined ? undefined : typeof value.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(value.ownerTokenHash) ? value.ownerTokenHash : undefined;
  if (value.ownerTokenHash !== undefined && !ownerTokenHash) return undefined;
  return { id: value.id.trim().slice(0, 120), name: value.name.trim().slice(0, MAX_NAME_LENGTH), payload, ...(request ? { request } : {}), catalogSnapshotAt: new Date(value.catalogSnapshotAt).toISOString(), createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString(), ...(expiresAt ? { expiresAt } : {}), ...(ownerTokenHash ? { ownerTokenHash } : {}) };
}

export function publicGeneratorVariantsShare(record: SavedGeneratorVariantsRecord, currentSnapshotAt?: string): GeneratorVariantsShareSnapshot {
  const catalogChangedSinceShare = currentSnapshotAt !== undefined && currentSnapshotAt !== record.catalogSnapshotAt;
  return { id: record.id, name: record.name, payload: record.payload, ...(record.request ? { request: record.request } : {}), catalogSnapshotAt: record.catalogSnapshotAt, ...(currentSnapshotAt ? { catalogCurrentSnapshotAt: currentSnapshotAt, catalogChangedSinceShare } : {}), createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}) };
}

export { generatorVariantsExportPayloadFromUnknown, shareExpiresAtFor, shareExpired };
