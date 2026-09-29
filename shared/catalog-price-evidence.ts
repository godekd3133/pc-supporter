import { isKnownPrice, type CatalogPriceEvidence, type DataQuality } from "./types";

/**
 * A numeric catalog price is not necessarily a current checkout price.
 * Keep this provenance separate from the API's known/unknown filter, which
 * only answers whether a numeric value exists.
 */
export const CATALOG_PRICE_EVIDENCE_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "가격",
  manual: "가격",
  reference: "가격",
  recorded: "가격",
  unknown: "-"
};

export const CATALOG_PRICE_EVIDENCE_CHECK_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "확인됨",
  manual: "확인됨",
  reference: "구매 전 확인",
  recorded: "구매 전 확인",
  unknown: "-"
};

export const CATALOG_PRICE_EVIDENCE_DESCRIPTIONS: Record<CatalogPriceEvidence, string> = {
  live: "상품 페이지에서 확인한 금액입니다. 판매처·재고·배송·옵션에 따라 결제 금액이 달라질 수 있으니 확인 날짜와 상품 페이지를 함께 확인해 주세요.",
  manual: "직접 입력한 금액입니다. 판매 페이지의 금액·재고와 다를 수 있으니 구매 전에 다시 확인해 주세요.",
  reference: "미리 등록한 금액입니다. 실제 판매가·재고와 다를 수 있어요.",
  recorded: "이전에 저장한 금액입니다. 구매 전에 상품 페이지의 금액과 사양을 다시 확인해 주세요.",
  unknown: "가격 정보가 없어 합계와 예산 계산에 포함하지 않아요."
};

export type CatalogPriceEvidenceInput = {
  dataQuality: DataQuality;
  priceWon?: number;
  source?: "seed" | "danawa" | "manual";
};

const CATALOG_PRICE_EVIDENCE_VALUES = ["live", "manual", "reference", "recorded", "unknown"] as const;

export function catalogPriceEvidenceFromUnknown(value: unknown): CatalogPriceEvidence | undefined {
  return typeof value === "string" && CATALOG_PRICE_EVIDENCE_VALUES.includes(value as CatalogPriceEvidence) ? value as CatalogPriceEvidence : undefined;
}

export function catalogPriceEvidenceFor(item: CatalogPriceEvidenceInput): CatalogPriceEvidence {
  if (!isKnownPrice(item.priceWon)) return "unknown";
  if (item.dataQuality === "live") return "live";
  if (item.dataQuality === "manual") return "manual";
  if (item.dataQuality === "seed" || item.source === "seed") return "reference";
  return "recorded";
}

export function catalogPriceEvidenceLabelFor(item: CatalogPriceEvidenceInput) {
  return CATALOG_PRICE_EVIDENCE_LABELS[catalogPriceEvidenceFor(item)];
}

export function catalogPriceEvidenceDescriptionFor(item: CatalogPriceEvidenceInput) {
  return CATALOG_PRICE_EVIDENCE_DESCRIPTIONS[catalogPriceEvidenceFor(item)];
}
