import { DATA_FRESHNESS_LABELS, type AccessoryCategory, type CatalogPriceEvidence, type DataFreshness, type PartCategory } from "./types";
import { CATALOG_PRICE_EVIDENCE_LABELS } from "./catalog-price-evidence";
import { PURCHASE_ITEM_STATUS_LABELS, purchaseListItemStatusFor } from "./purchase-list-status";
import type { PurchaseListItemStatus } from "./purchase-list-status";

export type PurchaseListSection = "핵심 부품" | "주변 부품";

export interface PurchaseListRow {
  id?: string;
  sourceKind?: "part" | "accessory";
  sourceId?: string;
  sourceCategory?: PartCategory | AccessoryCategory;
  section: PurchaseListSection;
  categoryLabel: string;
  name: string;
  quantity: number;
  connectionTarget?: string;
  unitPriceWon?: number;
  totalPriceWon?: number;
  /**
   * A numeric price can be a project reference or an old recorded value.
   * Keep this separate from totalPriceWon so a purchase list cannot imply
   * that every number is a current checkout price.
   */
  priceEvidence?: CatalogPriceEvidence;
  sourceUrl?: string;
  dataFreshness?: DataFreshness;
  refreshable?: boolean;
  listingType?: string;
}

export interface PurchaseListPriceEvidenceSummary {
  confirmedCount: number;
  referenceCount: number;
  recordedCount: number;
  unknownCount: number;
  untrackedCount: number;
  reviewCount: number;
}

export function purchaseListPriceEvidenceLabelFor(row: PurchaseListRow) {
  if (row.priceEvidence) return CATALOG_PRICE_EVIDENCE_LABELS[row.priceEvidence];
  return row.totalPriceWon === undefined ? CATALOG_PRICE_EVIDENCE_LABELS.unknown : "가격 출처 기록 없음";
}

export function purchaseListPriceEvidenceNeedsReviewFor(row: PurchaseListRow) {
  return row.priceEvidence !== undefined && row.priceEvidence !== "live" && row.priceEvidence !== "manual";
}

export function purchaseListPriceEvidenceSummaryFor(rows: ReadonlyArray<PurchaseListRow>): PurchaseListPriceEvidenceSummary {
  const summary: PurchaseListPriceEvidenceSummary = { confirmedCount: 0, referenceCount: 0, recordedCount: 0, unknownCount: 0, untrackedCount: 0, reviewCount: 0 };
  rows.forEach((row) => {
    const evidence = row.priceEvidence;
    if (!evidence) {
      summary.untrackedCount += 1;
      return;
    }
    if (evidence === "live" || evidence === "manual") summary.confirmedCount += 1;
    else if (evidence === "reference") summary.referenceCount += 1;
    else if (evidence === "recorded") summary.recordedCount += 1;
    else summary.unknownCount += 1;
    if (purchaseListPriceEvidenceNeedsReviewFor(row)) summary.reviewCount += 1;
  });
  return summary;
}

export function purchaseListRowKey(row: PurchaseListRow, index: number) {
  return row.id ?? `${row.section}:${row.categoryLabel}:${row.name}:${index}`;
}

export function purchaseListTotals(rows: PurchaseListRow[], section: PurchaseListSection) {
  const sectionRows = rows.filter((row) => row.section === section);
  return {
    totalPriceWon: sectionRows.reduce((total, row) => total + (row.totalPriceWon ?? 0), 0),
    priceComplete: sectionRows.every((row) => row.totalPriceWon !== undefined)
  };
}

export function purchaseListTextFor(rows: PurchaseListRow[], checkedIds?: ReadonlySet<string>, itemStates: ReadonlyArray<PurchaseListItemStatus> = []) {
  const core = purchaseListTotals(rows, "핵심 부품");
  const accessories = purchaseListTotals(rows, "주변 부품");
  const lines = ["PC Supporter 구매 목록", ""];
  for (const section of ["핵심 부품", "주변 부품"] as const) {
    const sectionRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.section === section);
    if (sectionRows.length === 0) continue;
    lines.push(`[${section}]`);
    for (const { row, index: rowIndex } of sectionRows) {
      const price = row.totalPriceWon === undefined ? "가격 확인 필요" : `${row.totalPriceWon.toLocaleString("ko-KR")}원`;
      const rowKey = purchaseListRowKey(row, rowIndex);
      const status = checkedIds ? `[${itemStates.length > 0 ? PURCHASE_ITEM_STATUS_LABELS[purchaseListItemStatusFor(itemStates, rowKey, checkedIds)] : checkedIds.has(rowKey) ? "구매 완료" : "구매 예정"}] ` : "";
      lines.push(`- ${status}${row.categoryLabel}: ${row.name} ×${row.quantity} · ${price} · 가격 출처 ${purchaseListPriceEvidenceLabelFor(row)}${row.listingType ? ` · ${row.listingType}` : ""}${row.dataFreshness ? ` · ${DATA_FRESHNESS_LABELS[row.dataFreshness]}` : ""}${row.connectionTarget ? ` · 연결 대상 ${row.connectionTarget}` : ""}${row.sourceUrl ? ` · ${row.sourceUrl}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`핵심 부품 합계: ${core.priceComplete ? `${core.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  lines.push(`주변 부품 합계: ${accessories.priceComplete ? `${accessories.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  lines.push(`전체 합계: ${core.priceComplete && accessories.priceComplete ? `${(core.totalPriceWon + accessories.totalPriceWon).toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  return lines.join("\n");
}

export function purchaseListCsvFor(rows: PurchaseListRow[], checkedIds?: ReadonlySet<string>, itemStates: ReadonlyArray<PurchaseListItemStatus> = []) {
  const escape = (value: string | number | undefined) => {
    const raw = value === undefined ? "" : String(value);
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const header = ["구분", "분류", "부품명", "수량", "단가(원)", "합계(원)", "가격 출처", "유통 조건", "갱신 상태", "연결 대상", "상품 링크", ...(checkedIds ? ["구매 상태"] : [])];
  const records = rows.map((row, index) => { const rowKey = purchaseListRowKey(row, index); return [row.section, row.categoryLabel, row.name, row.quantity, row.unitPriceWon, row.totalPriceWon, purchaseListPriceEvidenceLabelFor(row), row.listingType, row.dataFreshness ? DATA_FRESHNESS_LABELS[row.dataFreshness] : undefined, row.connectionTarget, row.sourceUrl, ...(checkedIds ? [itemStates.length > 0 ? PURCHASE_ITEM_STATUS_LABELS[purchaseListItemStatusFor(itemStates, rowKey, checkedIds)] : checkedIds.has(rowKey) ? "구매 완료" : "구매 예정"] : [])]; });
  return `\uFEFF${[header, ...records].map((record) => record.map(escape).join(",")).join("\r\n")}`;
}
