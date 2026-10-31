import { classifyDataFreshness } from "./data-freshness";
import { isKnownPrice, type CatalogPriceEvidence, type DataQuality } from "./types";

/**
 * A numeric catalog price is not necessarily a current checkout price.
 * Keep this provenance separate from the API's known/unknown filter, which
 * only answers whether a numeric value exists.
 */
export const CATALOG_PRICE_EVIDENCE_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "최근 확인",
  manual: "직접 입력",
  reference: "예시 가격",
  recorded: "다시 확인",
  unknown: "-"
};

export const CATALOG_PRICE_EVIDENCE_CHECK_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "최근 확인",
  manual: "직접 입력",
  reference: "구매 전 확인",
  recorded: "구매 전 확인",
  unknown: "-"
};

export const CATALOG_PRICE_EVIDENCE_DESCRIPTIONS: Record<CatalogPriceEvidence, string> = {
  live: "최근 상품 페이지에서 확인한 금액입니다.",
  manual: "구매 전 상품 페이지에서 가격을 확인해 주세요.",
  reference: "구매 전 상품 페이지에서 가격을 확인해 주세요.",
  recorded: "구매 전 상품 페이지에서 가격을 확인해 주세요.",
  unknown: "가격 정보가 없어 합계에 포함하지 않아요."
};

export type CatalogPriceEvidenceInput = {
  dataQuality: DataQuality;
  priceWon?: number;
  priceCheckedAt?: string;
  source?: "seed" | "danawa" | "manual";
  now?: string | number;
};

const CATALOG_PRICE_EVIDENCE_VALUES = ["live", "manual", "reference", "recorded", "unknown"] as const;

export function catalogPriceEvidenceFromUnknown(value: unknown): CatalogPriceEvidence | undefined {
  return typeof value === "string" && CATALOG_PRICE_EVIDENCE_VALUES.includes(value as CatalogPriceEvidence) ? value as CatalogPriceEvidence : undefined;
}

export function catalogPriceEvidenceFor(item: CatalogPriceEvidenceInput): CatalogPriceEvidence {
  if (!isKnownPrice(item.priceWon)) return "unknown";
  if (item.dataQuality === "seed" || item.source === "seed") return "reference";
  if (item.source === "manual" || (!item.source && item.dataQuality === "manual")) return "manual";
  if (classifyDataFreshness(item.priceCheckedAt, item.now) === "fresh") return "live";
  return "recorded";
}

export function catalogPriceEvidenceLabelFor(item: CatalogPriceEvidenceInput) {
  return CATALOG_PRICE_EVIDENCE_LABELS[catalogPriceEvidenceFor(item)];
}

export function catalogPriceEvidenceDescriptionFor(item: CatalogPriceEvidenceInput) {
  return CATALOG_PRICE_EVIDENCE_DESCRIPTIONS[catalogPriceEvidenceFor(item)];
}
