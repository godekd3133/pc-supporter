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
  live: "최근 상품 페이지에서 확인한 금액입니다. 판매처·재고·배송·옵션에 따라 결제 금액이 달라질 수 있으니 상품 페이지도 함께 확인해 주세요.",
  manual: "직접 입력한 금액입니다. 판매 페이지의 금액·재고와 다를 수 있으니 구매 전에 다시 확인해 주세요.",
  reference: "미리 등록한 금액입니다. 실제 판매가·재고와 다를 수 있어요.",
  recorded: "확인 시각이 없거나 오래된 금액입니다. 구매 전에 상품 페이지의 금액과 사양을 다시 확인해 주세요.",
  unknown: "가격 정보가 없어 합계와 예산 계산에 포함하지 않아요."
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
