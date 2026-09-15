import { isKnownPrice, type CatalogPriceEvidence, type DataQuality } from "./types";

/**
 * A numeric catalog price is not necessarily a current checkout price.
 * Keep this provenance separate from the API's known/unknown filter, which
 * only answers whether a numeric value exists.
 */
export const CATALOG_PRICE_EVIDENCE_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "다나와 가격",
  manual: "직접 확인한 가격",
  reference: "참고 가격",
  recorded: "예전 가격 · 재확인",
  unknown: "가격 확인 필요"
};

export const CATALOG_PRICE_EVIDENCE_DESCRIPTIONS: Record<CatalogPriceEvidence, string> = {
  live: "다나와에서 가져온 가격입니다. 판매처·재고·배송·옵션에 따라 실제 결제 금액은 달라질 수 있으니 갱신일과 판매 페이지를 함께 확인해 주세요.",
  manual: "직접 확인해 등록한 가격입니다. 지금 판매 페이지의 가격·재고와 다를 수 있으니 구매 전에 한 번 더 확인해 주세요.",
  reference: "미리 입력해 둔 참고 가격입니다. 실제 판매가·재고와 다를 수 있어요.",
  recorded: "가격은 기록되어 있지만 정보가 완전하지 않습니다. 구매 전에 판매 페이지의 가격과 스펙을 다시 확인해 주세요.",
  unknown: "가격을 아직 확인하지 못했습니다. 총액과 예산 계산에는 포함하지 않아요."
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
