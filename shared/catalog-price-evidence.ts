import { isKnownPrice, type CatalogPriceEvidence, type DataQuality } from "./types";

/**
 * A numeric catalog price is not necessarily a current checkout price.
 * Keep this provenance separate from the API's known/unknown filter, which
 * only answers whether a numeric value exists.
 */
export const CATALOG_PRICE_EVIDENCE_LABELS: Record<CatalogPriceEvidence, string> = {
  live: "다나와 수집가",
  manual: "수동 확인가",
  reference: "프로젝트 기준가",
  recorded: "기록가 · 재확인",
  unknown: "가격 확인 필요"
};

export const CATALOG_PRICE_EVIDENCE_DESCRIPTIONS: Record<CatalogPriceEvidence, string> = {
  live: "다나와에서 수집한 카탈로그 가격입니다. 판매처·재고·배송·옵션에 따라 실제 결제 금액은 달라질 수 있으므로 갱신일과 원문을 함께 확인하세요.",
  manual: "수동 검수로 기록한 가격입니다. 판매 페이지의 현재 가격·재고와 다를 수 있으므로 구매 전에 다시 확인하세요.",
  reference: "프로젝트 starter 기준값입니다. 실제 판매가·재고·구매 가능 여부를 의미하지 않습니다.",
  recorded: "숫자 가격은 기록되어 있지만 데이터 품질이 완전하지 않습니다. 구매 전에 원문 가격과 스펙을 다시 확인하세요.",
  unknown: "가격 숫자를 확인할 수 없습니다. 총액 비교와 예산 판단을 확정하지 않습니다."
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
