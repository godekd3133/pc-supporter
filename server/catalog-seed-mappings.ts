import type { CatalogSeedMappingReview } from "../shared/catalog-seed-mapping";
import { catalogSeedMappingCandidatesFor, catalogSeedMappingIdentityCompatibleFor } from "../shared/catalog-seed-mapping";
import type { Part, PartCategory } from "../shared/types";
import { PART_CATEGORIES } from "../shared/types";
import { DANAWA_CATEGORIES } from "./danawa";
import { CATALOG_SEED_MAPPINGS_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";

const MAX_NOTE_LENGTH = 500;
const MAX_SOURCE_URL_LENGTH = 500;
const MAX_SOURCE_PRODUCT_CODE_LENGTH = 64;

export type CatalogSeedMappingReviewValidation = {
  valid: boolean;
  errors: string[];
  review?: CatalogSeedMappingReview;
};

function nonEmptyString(value: unknown, maxLength = 160) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : undefined;
}

export type CatalogSeedMappingManualInput = {
  sourceProductCode: string;
  sourceUrl: string;
};

export type CatalogSeedMappingManualInputValidation = {
  valid: boolean;
  errors: string[];
  input?: CatalogSeedMappingManualInput;
};

function danawaCategoryIdFor(category: PartCategory) {
  return DANAWA_CATEGORIES.find((entry) => entry.category === category)?.categoryId;
}

export function validateCatalogSeedMappingManualInput(input: unknown, category?: PartCategory): CatalogSeedMappingManualInputValidation {
  const errors: string[] = [];
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const sourceProductCode = nonEmptyString(body.sourceProductCode, MAX_SOURCE_PRODUCT_CODE_LENGTH);
  const sourceUrl = nonEmptyString(body.sourceUrl, MAX_SOURCE_URL_LENGTH);
  if (!sourceProductCode || !/^[0-9A-Za-z_-]{3,64}$/.test(sourceProductCode)) errors.push("다나와 상품 코드는 영문·숫자·하이픈·밑줄 3~64자로 입력해 주세요.");
  if (!sourceUrl) errors.push("다나와 원문 URL이 필요합니다.");
  if (!sourceProductCode || !sourceUrl || errors.length > 0) return { valid: false, errors };

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    errors.push("다나와 원문 URL 형식이 올바르지 않습니다.");
    return { valid: false, errors };
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLocaleLowerCase("en-US") !== "prod.danawa.com") errors.push("prod.danawa.com의 HTTPS 상품 URL만 등록할 수 있습니다.");
  if (parsed.searchParams.get("pcode") !== sourceProductCode) errors.push("URL의 pcode와 입력한 상품 코드가 일치하지 않습니다.");
  const expectedCategoryId = category ? danawaCategoryIdFor(category) : undefined;
  const sourceCategoryId = parsed.searchParams.get("cate");
  if (expectedCategoryId && sourceCategoryId && sourceCategoryId !== expectedCategoryId) errors.push("URL의 다나와 범주가 starter 범주와 일치하지 않습니다.");
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], input: { sourceProductCode, sourceUrl } };
}

export function catalogSeedMappingReviewConflictFor(reviews: Record<string, CatalogSeedMappingReview>, starterPartId: string, activePartId: string) {
  return Object.values(reviews).find((review) => review.status === "approved" && review.starterPartId !== starterPartId && review.activePartId === activePartId);
}

export function sourceIdentitiesFor(starter: Part, active: Part, sourceProductCode: string) {
  return [...new Set([active.model, active.name, starter.model, starter.name, sourceProductCode].filter((value): value is string => Boolean(value?.trim())))];
}

function usableReview(value: unknown): value is CatalogSeedMappingReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CatalogSeedMappingReview>;
  return Boolean(
    nonEmptyString(candidate.starterPartId) &&
    PART_CATEGORIES.includes(candidate.category as Part["category"]) &&
    nonEmptyString(candidate.activePartId) &&
    nonEmptyString(candidate.activeSourceProductCode) &&
    candidate.status === "approved" &&
    typeof candidate.reviewedAt === "string" &&
    Number.isFinite(Date.parse(candidate.reviewedAt)) &&
    (candidate.note === undefined || (typeof candidate.note === "string" && candidate.note.trim().length <= MAX_NOTE_LENGTH))
  );
}

export async function readCatalogSeedMappingReviews() {
  const raw = await readJson<unknown>(CATALOG_SEED_MAPPINGS_PATH, { schemaVersion: 1, items: [] });
  const rawItems: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>).items)
      ? (raw as Record<string, unknown>).items as unknown[]
      : [];
  const reviews = new Map<string, CatalogSeedMappingReview>();
  for (const item of rawItems) {
    if (usableReview(item)) reviews.set(item.starterPartId, item);
  }
  return Object.fromEntries(reviews);
}

export function validateCatalogSeedMappingReview(
  starterPartId: string,
  input: unknown,
  starterCatalog: Part[],
  activeCatalog: Part[],
  options: { now?: () => string } = {}
): CatalogSeedMappingReviewValidation {
  const errors: string[] = [];
  const normalizedStarterPartId = nonEmptyString(starterPartId);
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const activePartId = nonEmptyString(body.activePartId);
  const status = body.status;
  const note = body.note === undefined ? undefined : nonEmptyString(body.note, MAX_NOTE_LENGTH);
  if (!normalizedStarterPartId) errors.push("starterPartId가 필요합니다.");
  if (!activePartId) errors.push("activePartId가 필요합니다.");
  if (status !== "approved") errors.push("status는 approved만 사용할 수 있습니다.");
  if (body.note !== undefined && note === undefined) errors.push(`note는 ${MAX_NOTE_LENGTH}자 이하의 문자열이어야 합니다.`);

  const starter = normalizedStarterPartId ? starterCatalog.find((part) => part.id === normalizedStarterPartId) : undefined;
  const active = activePartId ? activeCatalog.find((part) => part.id === activePartId) : undefined;
  if (!starter) errors.push("starter 기준 후보를 찾을 수 없습니다.");
  if (!active) errors.push("현재 카탈로그의 대상을 찾을 수 없습니다.");
  if (starter && active && starter.category !== active.category) errors.push("starter와 현재 후보의 범주가 다릅니다.");
  if (active && active.source !== "danawa") errors.push("실제 상품 코드가 있는 다나와 후보만 매핑할 수 있습니다.");
  if (active && !active.sourceProductCode) errors.push("현재 후보에 source product code가 없습니다.");
  if (starter && active && active.source === "danawa" && active.sourceProductCode) {
    const candidate = catalogSeedMappingCandidatesFor(starter, activeCatalog, { limit: 5 }).find((item) => item.activePartId === active.id && item.activeSourceProductCode === active.sourceProductCode);
    if (!candidate) errors.push("현재 후보가 자동 매핑 후보에 없습니다. 이름·모델을 다시 확인해 주세요.");
  }
  if (errors.length > 0 || !starter || !active || !active.sourceProductCode || active.source !== "danawa") return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    review: {
      starterPartId: starter.id,
      category: starter.category,
      activePartId: active.id,
      activeSourceProductCode: active.sourceProductCode,
      status: "approved",
      reviewedAt: options.now?.() ?? new Date().toISOString(),
      ...(note ? { note } : {})
    }
  };
}

export async function saveCatalogSeedMappingReview(review: CatalogSeedMappingReview) {
  return withSerializedFileMutation(CATALOG_SEED_MAPPINGS_PATH, async () => {
    const reviews = await readCatalogSeedMappingReviews();
    reviews[review.starterPartId] = review;
    const items = Object.values(reviews).sort((left, right) => left.starterPartId.localeCompare(right.starterPartId));
    await writeJson(CATALOG_SEED_MAPPINGS_PATH, { schemaVersion: 1, items });
    return review;
  });
}

export async function deleteCatalogSeedMappingReview(starterPartId: string) {
  return withSerializedFileMutation(CATALOG_SEED_MAPPINGS_PATH, async () => {
    const reviews = await readCatalogSeedMappingReviews();
    const deleted = Boolean(reviews[starterPartId]);
    delete reviews[starterPartId];
    await writeJson(CATALOG_SEED_MAPPINGS_PATH, { schemaVersion: 1, items: Object.values(reviews).sort((left, right) => left.starterPartId.localeCompare(right.starterPartId)) });
    return deleted;
  });
}
