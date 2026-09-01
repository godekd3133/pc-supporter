import { DATA_FRESHNESS_LABELS, type DataFreshness } from "./types";

export type PurchaseListSection = "핵심 부품" | "주변 부품";

export interface PurchaseListRow {
  section: PurchaseListSection;
  categoryLabel: string;
  name: string;
  quantity: number;
  unitPriceWon?: number;
  totalPriceWon?: number;
  sourceUrl?: string;
  dataFreshness?: DataFreshness;
  listingType?: string;
}

export function purchaseListTotals(rows: PurchaseListRow[], section: PurchaseListSection) {
  const sectionRows = rows.filter((row) => row.section === section);
  return {
    totalPriceWon: sectionRows.reduce((total, row) => total + (row.totalPriceWon ?? 0), 0),
    priceComplete: sectionRows.every((row) => row.totalPriceWon !== undefined)
  };
}

export function purchaseListTextFor(rows: PurchaseListRow[]) {
  const core = purchaseListTotals(rows, "핵심 부품");
  const accessories = purchaseListTotals(rows, "주변 부품");
  const lines = ["PC Supporter 구매 목록", ""];
  for (const section of ["핵심 부품", "주변 부품"] as const) {
    const sectionRows = rows.filter((row) => row.section === section);
    if (sectionRows.length === 0) continue;
    lines.push(`[${section}]`);
    for (const row of sectionRows) {
      const price = row.totalPriceWon === undefined ? "가격 확인 필요" : `${row.totalPriceWon.toLocaleString("ko-KR")}원`;
      lines.push(`- ${row.categoryLabel}: ${row.name} ×${row.quantity} · ${price}${row.listingType ? ` · ${row.listingType}` : ""}${row.dataFreshness ? ` · ${DATA_FRESHNESS_LABELS[row.dataFreshness]}` : ""}${row.sourceUrl ? ` · ${row.sourceUrl}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`핵심 부품 합계: ${core.priceComplete ? `${core.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  lines.push(`주변 부품 합계: ${accessories.priceComplete ? `${accessories.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  lines.push(`전체 합계: ${core.priceComplete && accessories.priceComplete ? `${(core.totalPriceWon + accessories.totalPriceWon).toLocaleString("ko-KR")}원` : "가격 확인 필요"}`);
  return lines.join("\n");
}

export function purchaseListCsvFor(rows: PurchaseListRow[]) {
  const escape = (value: string | number | undefined) => {
    const raw = value === undefined ? "" : String(value);
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const header = ["구분", "분류", "부품명", "수량", "단가(원)", "합계(원)", "유통 조건", "갱신 상태", "원문 링크"];
  const records = rows.map((row) => [row.section, row.categoryLabel, row.name, row.quantity, row.unitPriceWon, row.totalPriceWon, row.listingType, row.dataFreshness ? DATA_FRESHNESS_LABELS[row.dataFreshness] : undefined, row.sourceUrl]);
  return `\uFEFF${[header, ...records].map((record) => record.map(escape).join(",")).join("\r\n")}`;
}
