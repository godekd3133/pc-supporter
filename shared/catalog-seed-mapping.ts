import type { Part, PartCategory, PhysicalSourceCheck, PhysicalSourceIdentityStatus } from "./types";
import { PART_CATEGORIES } from "./types";

export type CatalogSeedMappingConfidence = "high" | "review";
export type CatalogSeedMappingReason = "name_exact" | "model_match" | "brand_match" | "identity_tokens" | "price_near";
export type CatalogSeedMappingStatus = "pending" | "approved" | "stale";

export interface CatalogSeedMappingVerification {
  sourceCheck: PhysicalSourceCheck;
  identityStatus: PhysicalSourceIdentityStatus;
  categoryMatched: true;
  coreSpecsMatched: true;
}

export interface CatalogSeedMappingReview {
  starterPartId: string;
  category: PartCategory;
  activePartId: string;
  activeSourceProductCode: string;
  status: "approved";
  reviewedAt: string;
  note?: string;
  sourceUrl?: string;
  verification?: CatalogSeedMappingVerification;
}

export interface CatalogSeedMappingCandidate {
  activePartId: string;
  activeSourceProductCode: string;
  activeName: string;
  activeBrand?: string;
  activeModel?: string;
  activeSource: Part["source"];
  activeDataQuality: Part["dataQuality"];
  activePriceWon?: number;
  activeUrl?: string;
  score: number;
  confidence: CatalogSeedMappingConfidence;
  reasons: CatalogSeedMappingReason[];
  priceDeltaPercent?: number;
}

export interface CatalogSeedMappingItem {
  starter: {
    id: string;
    category: PartCategory;
    name: string;
    brand?: string;
    model?: string;
    priceWon?: number;
  };
  status: CatalogSeedMappingStatus;
  candidates: CatalogSeedMappingCandidate[];
  approvedMapping?: CatalogSeedMappingReview;
}

export interface CatalogSeedMappingPreview {
  schemaVersion: 1;
  kind: "catalog-seed-mapping-preview";
  generatedAt: string;
  readOnly: true;
  activeCatalogCount: number;
  summary: {
    missingStarterCount: number;
    candidateCount: number;
    highConfidenceCount: number;
    reviewRequiredCount: number;
    noCandidateCount: number;
    pendingCount: number;
    approvedCount: number;
    staleCount: number;
  };
  items: CatalogSeedMappingItem[];
}

const STOP_TOKENS = new Set([
  "amd", "intel", "nvidia", "geforce", "radeon", "arc", "ryzen", "core", "samsung", "msi", "asus", "asrock", "gigabyte", "gskill", "corsair", "adata", "crucial", "kingston", "teamgroup", "western", "digital", "wd", "seagate", "toshiba", "sata", "nvme", "m2", "pcie", "wifi", "gaming", "plus", "pro", "black", "white", "basic", "multi", "pc", "supporter"
]);

const MODEL_PREFIX_TOKENS = new Set(["amd", "intel", "nvidia", "geforce", "radeon", "arc", "ryzen", "core", "samsung", "msi", "asus", "asrock", "gigabyte", "gskill", "corsair", "adata", "crucial", "kingston", "teamgroup", "western", "digital", "wd", "seagate", "toshiba", "인텔", "엔비디아", "지포스", "라데온", "코어", "라이젠"]);
const MODEL_VARIANT_TOKENS = new Set(["super", "ti", "xt", "xtx", "x", "f", "k", "ks", "g", "e", "a"]);

function normalizedCompact(value: string | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function identityTokens(value: string | undefined) {
  return [...new Set((value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").split(/[^0-9a-z가-힣]+/i).map((token) => token.trim()).filter((token) => token.length >= 2 && !STOP_TOKENS.has(token)))];
}

function modelTokens(value: string | undefined) {
  return [...new Set((value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").split(/[^0-9a-z가-힣]+/i).map((token) => token.trim()).filter((token) => token.length >= 1 && !MODEL_PREFIX_TOKENS.has(token)))];
}

function containsModelTokenSequence(haystack: string[], needle: string[]) {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (!needle.every((token, offset) => haystack[index + offset] === token)) continue;
    const followingToken = haystack[index + needle.length];
    if (followingToken && MODEL_VARIANT_TOKENS.has(followingToken)) continue;
    return true;
  }
  return false;
}

function identityTokenSet(part: Part) {
  return new Set([part.name, part.brand, part.model].flatMap(identityTokens));
}

function partReference(part: Part) {
  return {
    id: part.id,
    category: part.category,
    name: part.name,
    ...(part.brand ? { brand: part.brand } : {}),
    ...(part.model ? { model: part.model } : {}),
    ...(part.priceWon !== undefined ? { priceWon: part.priceWon } : {})
  };
}

function categoryIndex(category: PartCategory) {
  return PART_CATEGORIES.indexOf(category);
}

function dataQualityRank(value: Part["dataQuality"]) {
  return value === "live" ? 3 : value === "manual" ? 2 : value === "incomplete" ? 1 : 0;
}

type ProductFamily = "amd" | "intel" | "nvidia";

function productFamily(part: Part): ProductFamily | undefined {
  if (part.category === "gpu" && part.specs.gpuVendor) return part.specs.gpuVendor;

  const text = normalizedCompact([part.brand, part.name, part.model].filter(Boolean).join(" "));
  if (part.category === "cpu") {
    if (/amd|라이젠|ryzen|threadripper|athlon/.test(text)) return "amd";
    if (/intel|인텔|core|코어|xeon|셀러론|펜티엄/.test(text)) return "intel";
  }
  if (part.category === "gpu") {
    if (/amd|라데온|radeon|rx\d/.test(text)) return "amd";
    if (/nvidia|엔비디아|지포스|geforce|rtx|gtx/.test(text)) return "nvidia";
    if (/intel|인텔|arc/.test(text)) return "intel";
  }
  return undefined;
}

function comparableSpec(part: Part, key: "socket" | "memoryType" | "formFactor" | "interface") {
  if (key === "formFactor" && part.category === "memory") return part.specs.memoryFormFactor ?? part.specs.formFactor;
  return part.specs[key];
}

function hasIdentityConflict(starter: Part, active: Part) {
  const starterFamily = productFamily(starter);
  const activeFamily = productFamily(active);
  if (starterFamily && activeFamily && starterFamily !== activeFamily && ["cpu", "gpu"].includes(starter.category)) return true;

  const keys: Array<"socket" | "memoryType" | "formFactor" | "interface"> = starter.category === "cpu" || starter.category === "motherboard"
    ? ["socket", "memoryType"]
    : starter.category === "memory"
      ? ["memoryType", "formFactor"]
      : starter.category === "ssd" || starter.category === "hdd"
        ? ["interface", "formFactor"]
        : [];

  return keys.some((key) => {
    const starterValue = comparableSpec(starter, key);
    const activeValue = comparableSpec(active, key);
    return typeof starterValue === "string" && typeof activeValue === "string" && normalizedCompact(starterValue) !== normalizedCompact(activeValue);
  });
}

export function catalogSeedMappingIdentityCompatibleFor(starter: Part, active: Part) {
  return starter.category === active.category && !hasIdentityConflict(starter, active);
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function candidateFor(starter: Part, active: Part): CatalogSeedMappingCandidate | undefined {
  if (starter.category !== active.category || active.source !== "danawa" || !active.sourceProductCode) return undefined;
  if (hasIdentityConflict(starter, active)) return undefined;

  const starterName = normalizedCompact(starter.name);
  const activeName = normalizedCompact(active.name);
  const starterModel = normalizedCompact(starter.model);
  const activeModel = normalizedCompact(active.model);
  const nameExact = Boolean(starterName && activeName && starterName === activeName);
  const starterModelTokens = modelTokens(starter.model);
  const activeModelTokens = modelTokens(active.model);
  const activeNameTokens = modelTokens(active.name);
  const modelMatch = Boolean(starterModel.length >= 4 && (activeModel === starterModel || containsModelTokenSequence(activeModelTokens, starterModelTokens) || containsModelTokenSequence(activeNameTokens, starterModelTokens)));
  const starterTokens = identityTokenSet(starter);
  const activeTokens = identityTokenSet(active);
  const overlapCount = [...starterTokens].filter((token) => activeTokens.has(token)).length;
  const overlapRatio = starterTokens.size === 0 ? 0 : overlapCount / Math.min(starterTokens.size, Math.max(1, activeTokens.size));
  const brandMatch = Boolean(starter.brand && active.brand && normalizedCompact(starter.brand) === normalizedCompact(active.brand));
  if (!nameExact && !modelMatch && overlapCount < 2) return undefined;

  const reasons: CatalogSeedMappingReason[] = [];
  let score = 0;
  if (nameExact) {
    score += 0.82;
    reasons.push("name_exact");
  }
  if (modelMatch) {
    score += 0.72;
    reasons.push("model_match");
  }
  if (brandMatch) {
    score += 0.12;
    reasons.push("brand_match");
  }
  if (overlapCount >= 2) {
    score += Math.min(0.12, overlapRatio * 0.12);
    reasons.push("identity_tokens");
  }

  let priceDeltaPercent: number | undefined;
  if (starter.priceWon !== undefined && starter.priceWon > 0 && active.priceWon !== undefined && active.priceWon > 0) {
    priceDeltaPercent = rounded(Math.abs(active.priceWon - starter.priceWon) / starter.priceWon * 100);
    if (priceDeltaPercent <= 15) {
      score += 0.04;
      reasons.push("price_near");
    }
  }

  score = Math.min(0.99, rounded(score));
  if (score < 0.55) return undefined;
  return {
    activePartId: active.id,
    activeSourceProductCode: active.sourceProductCode,
    activeName: active.name,
    ...(active.brand ? { activeBrand: active.brand } : {}),
    ...(active.model ? { activeModel: active.model } : {}),
    activeSource: active.source,
    activeDataQuality: active.dataQuality,
    ...(active.priceWon !== undefined ? { activePriceWon: active.priceWon } : {}),
    ...(active.danawaUrl ? { activeUrl: active.danawaUrl } : {}),
    score,
    confidence: score >= 0.86 && (nameExact || modelMatch) ? "high" : "review",
    reasons,
    ...(priceDeltaPercent !== undefined ? { priceDeltaPercent } : {})
  };
}

export function catalogSeedMappingCandidatesFor(starter: Part, activeCatalog: Part[], options: { limit?: number } = {}) {
  const limit = Math.min(5, Math.max(1, Math.floor(options.limit ?? 3)));
  return activeCatalog
    .map((active) => candidateFor(starter, active))
    .filter((candidate): candidate is CatalogSeedMappingCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score || dataQualityRank(right.activeDataQuality) - dataQualityRank(left.activeDataQuality) || left.activeName.localeCompare(right.activeName, "ko-KR"))
    .slice(0, limit);
}

function activeByKey(activeCatalog: Part[]) {
  return new Map(activeCatalog.map((part) => [`${part.category}:${part.id}`, part]));
}

export function catalogSeedMappingPreviewFor(
  starterCatalog: Part[],
  activeCatalog: Part[],
  options: { generatedAt?: string; reviews?: Record<string, CatalogSeedMappingReview> } = {}
): CatalogSeedMappingPreview {
  // The runtime catalog intentionally retains starter rows after live data is
  // persisted. They are reference fallbacks, not evidence that a starter has
  // been mapped to a real source product. Mapping review must therefore use
  // non-starter rows for presence, candidate discovery, and stale detection.
  const mappingCatalog = activeCatalog.filter((part) => part.source !== "seed");
  const activeKeys = activeByKey(mappingCatalog);
  const activeByCategory = new Map<PartCategory, Part[]>();
  for (const part of mappingCatalog) {
    const categoryParts = activeByCategory.get(part.category);
    if (categoryParts) categoryParts.push(part);
    else activeByCategory.set(part.category, [part]);
  }
  const items = starterCatalog
    .filter((starter) => !activeKeys.has(`${starter.category}:${starter.id}`))
    .map((starter): CatalogSeedMappingItem => {
      const review = options.reviews?.[starter.id];
      const activeReviewCandidate = review ? activeKeys.get(`${starter.category}:${review.activePartId}`) : undefined;
      const activeReviewPart = review && activeReviewCandidate?.sourceProductCode === review.activeSourceProductCode ? activeReviewCandidate : undefined;
      const candidates = catalogSeedMappingCandidatesFor(starter, activeByCategory.get(starter.category) ?? []);
      const status: CatalogSeedMappingStatus = review?.status === "approved" ? activeReviewPart ? "approved" : "stale" : "pending";
      return {
        starter: partReference(starter),
        status,
        candidates,
        ...(status === "approved" || status === "stale" ? { approvedMapping: review } : {})
      };
    })
    .sort((left, right) => categoryIndex(left.starter.category) - categoryIndex(right.starter.category) || left.starter.name.localeCompare(right.starter.name, "ko-KR"));

  const highConfidenceCount = items.filter((item) => item.candidates[0]?.confidence === "high").length;
  const candidateCount = items.filter((item) => item.candidates.length > 0).length;
  const approvedCount = items.filter((item) => item.status === "approved").length;
  const staleCount = items.filter((item) => item.status === "stale").length;
  return {
    schemaVersion: 1,
    kind: "catalog-seed-mapping-preview",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    readOnly: true,
    activeCatalogCount: activeCatalog.length,
    summary: {
      missingStarterCount: items.length,
      candidateCount,
      highConfidenceCount,
      reviewRequiredCount: Math.max(0, candidateCount - highConfidenceCount),
      noCandidateCount: Math.max(0, items.length - candidateCount),
      pendingCount: items.filter((item) => item.status === "pending").length,
      approvedCount,
      staleCount
    },
    items
  };
}
