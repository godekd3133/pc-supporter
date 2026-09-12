import {
  CATALOG_CATEGORY_INTEGRITY_RULE_VERSION,
  catalogCategoryIntegritySignalLabelFor,
  catalogCategoryIntegritySummaryFor,
  catalogCategoryMismatchFor,
  type CatalogCategoryIntegritySignal
} from "./catalog-category-integrity";
import type { DataQuality, ListingType, Part } from "./types";

export const CATALOG_CATEGORY_INTEGRITY_REVIEW_SCHEMA_VERSION = 1 as const;
export const CATALOG_CATEGORY_INTEGRITY_REVIEW_RULE_VERSION = CATALOG_CATEGORY_INTEGRITY_RULE_VERSION;

export interface CatalogCategoryIntegrityReviewItem {
  partId: string;
  partName: string;
  category: "motherboard";
  signal: CatalogCategoryIntegritySignal;
  label: string;
  reason: string;
  source: Part["source"];
  sourceProductCode?: string;
  sourceCategoryId?: string;
  sourceUrl?: string;
  listingType?: ListingType;
  dataQuality: DataQuality;
  updatedAt: string;
  priceWon?: number;
  rawSpecExcerpt?: string;
  catalogUrl: string;
}

export interface CatalogCategoryIntegrityReviewPackage {
  schemaVersion: typeof CATALOG_CATEGORY_INTEGRITY_REVIEW_SCHEMA_VERSION;
  kind: "catalog-category-integrity-review-package";
  generatedAt: string;
  ruleVersion: typeof CATALOG_CATEGORY_INTEGRITY_REVIEW_RULE_VERSION;
  offset: number;
  limit: number;
  nextOffset?: number;
  queueChanged?: boolean;
  checkedCount: number;
  mismatchCount: number;
  queueTotal: number;
  includedCount: number;
  remainingCount: number;
  queueFingerprint: string;
  items: CatalogCategoryIntegrityReviewItem[];
}

export interface CatalogCategoryIntegrityReviewPackageOptions {
  offset?: number;
  limit?: number;
  generatedAt?: string;
}

const SIGNAL_ORDER: CatalogCategoryIntegritySignal[] = ["raspberry_pi", "arduino", "embedded_board", "non_pc_component"];
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;
const RAW_SPEC_EXCERPT_LIMIT = 360;

function normalizedRawSpecExcerpt(value: string | undefined) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > RAW_SPEC_EXCERPT_LIMIT
    ? `${normalized.slice(0, RAW_SPEC_EXCERPT_LIMIT - 1)}…`
    : normalized;
}

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function catalogCategoryIntegrityReviewFingerprintFor(items: CatalogCategoryIntegrityReviewItem[]) {
  return `ccir1-${hashText(JSON.stringify({
    ruleVersion: CATALOG_CATEGORY_INTEGRITY_REVIEW_RULE_VERSION,
    items: items.map((item) => ({
      partId: item.partId,
      partName: item.partName,
      signal: item.signal,
      reason: item.reason,
      source: item.source,
      sourceProductCode: item.sourceProductCode,
      sourceCategoryId: item.sourceCategoryId,
      sourceUrl: item.sourceUrl,
      listingType: item.listingType,
      dataQuality: item.dataQuality,
      updatedAt: item.updatedAt,
      priceWon: item.priceWon,
      rawSpecExcerpt: item.rawSpecExcerpt
    }))
  }))}`;
}

export function catalogCategoryIntegrityReviewItemsFor(catalog: Part[]): CatalogCategoryIntegrityReviewItem[] {
  return catalog
    .flatMap((part) => {
      const mismatch = catalogCategoryMismatchFor(part);
      if (!mismatch) return [];
      const rawSpecExcerpt = normalizedRawSpecExcerpt(part.rawSpecText);
      return [{
        partId: part.id,
        partName: part.name,
        category: "motherboard" as const,
        signal: mismatch.signal,
        label: catalogCategoryIntegritySignalLabelFor(mismatch.signal),
        reason: mismatch.reason,
        source: part.source,
        ...(part.sourceProductCode ? { sourceProductCode: part.sourceProductCode } : {}),
        ...(part.sourceCategoryId ? { sourceCategoryId: part.sourceCategoryId } : {}),
        ...(part.danawaUrl ? { sourceUrl: part.danawaUrl } : {}),
        ...(part.listingType ? { listingType: part.listingType } : {}),
        dataQuality: part.dataQuality,
        updatedAt: part.updatedAt,
        ...(part.priceWon !== undefined ? { priceWon: part.priceWon } : {}),
        ...(rawSpecExcerpt ? { rawSpecExcerpt } : {}),
        catalogUrl: `/catalog?category=motherboard&partId=${encodeURIComponent(part.id)}`
      }];
    })
    .sort((left, right) => SIGNAL_ORDER.indexOf(left.signal) - SIGNAL_ORDER.indexOf(right.signal)
      || left.partName.localeCompare(right.partName, "ko-KR")
      || left.partId.localeCompare(right.partId));
}

export function catalogCategoryIntegrityReviewPackageFor(catalog: Part[], options: CatalogCategoryIntegrityReviewPackageOptions = {}): CatalogCategoryIntegrityReviewPackage {
  const summary = catalogCategoryIntegritySummaryFor(catalog);
  const reviewItems = catalogCategoryIntegrityReviewItemsFor(catalog);
  const offset = Number.isFinite(options.offset) ? Math.min(100_000, Math.max(0, Math.floor(options.offset ?? 0))) : 0;
  const limit = Number.isFinite(options.limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT))) : DEFAULT_LIMIT;
  const items = reviewItems.slice(offset, offset + limit);
  const remainingCount = Math.max(0, reviewItems.length - offset - items.length);

  return {
    schemaVersion: CATALOG_CATEGORY_INTEGRITY_REVIEW_SCHEMA_VERSION,
    kind: "catalog-category-integrity-review-package",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ruleVersion: CATALOG_CATEGORY_INTEGRITY_REVIEW_RULE_VERSION,
    offset,
    limit,
    ...(remainingCount > 0 ? { nextOffset: offset + items.length } : {}),
    checkedCount: summary.checkedCount,
    mismatchCount: summary.mismatchCount,
    queueTotal: reviewItems.length,
    includedCount: items.length,
    remainingCount,
    queueFingerprint: catalogCategoryIntegrityReviewFingerprintFor(reviewItems),
    items
  };
}
