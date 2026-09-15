import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection, Part } from "./types";
import { buildPriceSnapshotFor } from "./build-price-summary";
import { purchaseListCsvFor, purchaseListPriceEvidenceSummaryFor, purchaseListTextFor, purchaseListTotals } from "./purchase-list";

const rows = [
  { section: "핵심 부품" as const, categoryLabel: "CPU", name: "테스트, CPU\n\"특별판\"", quantity: 1, unitPriceWon: 100000, totalPriceWon: 100000, priceEvidence: "live" as const, sourceUrl: "https://prod.danawa.com/info/?pcode=1" },
  { section: "주변 부품" as const, categoryLabel: "쿨링팬", name: "가격 미확인 팬", quantity: 2, priceEvidence: "unknown" as const, listingType: "신품·정식 유통", dataFreshness: "stale" as const }
];

describe("purchase list serialization", () => {
  it("separates core and accessory totals without treating unknown prices as zero", () => {
    expect(purchaseListTotals(rows, "핵심 부품")).toEqual({ totalPriceWon: 100000, priceComplete: true });
    expect(purchaseListTotals(rows, "주변 부품")).toEqual({ totalPriceWon: 0, priceComplete: false });

    const cpu: Part = { id: "cpu-1", category: "cpu", name: "테스트 CPU", source: "manual", priceWon: 100000, specs: {}, dataQuality: "manual", missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" };
    const fan: AccessoryItem = { id: "fan-1", category: "cooling_fan", name: "테스트 팬", source: "manual", listingType: "accessory", priceWon: 10000, specs: {}, dataQuality: "manual", missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" };
    const build: BuildSelection = { cpu: { partId: cpu.id, quantity: 2 }, memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: fan.id, quantity: 3 }], useIntegratedGraphics: true };
    expect(buildPriceSnapshotFor(build, new Map([[cpu.id, cpu]]), new Map([[fan.id, fan]]))).toMatchObject({ coreTotalPriceWon: 200000, accessoryTotalPriceWon: 30000, totalPriceWon: 230000, corePriceComplete: true, accessoryPriceComplete: true, priceComplete: true, unknownPriceCount: 0 });
    expect(buildPriceSnapshotFor(build, new Map([[cpu.id, cpu]]), new Map([[fan.id, { ...fan, priceWon: undefined }]]))).toMatchObject({ coreTotalPriceWon: 200000, accessoryTotalPriceWon: 0, totalPriceWon: 200000, corePriceComplete: true, accessoryPriceComplete: false, priceComplete: false, unknownPriceCount: 1 });
  });

  it("preserves quantities, source URLs, newlines, and unknown price labels in text", () => {
    const text = purchaseListTextFor(rows);
    expect(text).toContain("테스트, CPU\n\"특별판\" ×1");
    expect(text).toContain("가격 미확인 팬 ×2 · 가격 확인 필요 · 가격 출처 가격 확인 필요 · 신품·정식 유통 · 오래된 정보");
    expect(text).toContain("https://prod.danawa.com/info/?pcode=1");
    expect(text).toContain("전체 합계: 가격 확인 필요");
  });

  it("quotes CSV cells and leaves unknown numeric cells blank", () => {
    const csv = purchaseListCsvFor(rows);
    expect(csv.startsWith("\uFEFF구분,분류,부품명")).toBe(true);
    expect(csv).toContain('"테스트, CPU\n""특별판"""');
    expect(csv).toContain("주변 부품,쿨링팬,가격 미확인 팬,2,,,가격 확인 필요,신품·정식 유통,오래된 정보,,");
  });

  it("keeps accessory connection targets in copied text and CSV", () => {
    const targetedRows = [{ ...rows[1]!, id: "accessory:fan:hub-a", connectionTarget: "팬 허브 허브 A" }];
    expect(purchaseListTextFor(targetedRows)).toContain("연결 대상 팬 허브 허브 A");
    const csv = purchaseListCsvFor(targetedRows);
    expect(csv).toContain("가격 출처,유통 조건,갱신 상태,연결 대상,원문 링크");
    expect(csv).toContain("가격 확인 필요,신품·정식 유통,오래된 정보,팬 허브 허브 A,");
  });

  it("summarizes current, reference, recorded, and unknown price evidence", () => {
    expect(purchaseListPriceEvidenceSummaryFor([
      { section: "핵심 부품", categoryLabel: "CPU", name: "실시간", quantity: 1, priceEvidence: "live" },
      { section: "핵심 부품", categoryLabel: "GPU", name: "수동", quantity: 1, priceEvidence: "manual" },
      { section: "핵심 부품", categoryLabel: "RAM", name: "기준", quantity: 1, priceEvidence: "reference", totalPriceWon: 100 },
      { section: "핵심 부품", categoryLabel: "SSD", name: "기록", quantity: 1, priceEvidence: "recorded", totalPriceWon: 200 },
      { section: "핵심 부품", categoryLabel: "케이스", name: "미확인", quantity: 1, priceEvidence: "unknown" },
      { section: "핵심 부품", categoryLabel: "파워", name: "이전 행", quantity: 1, totalPriceWon: 300 }
    ])).toEqual({ confirmedCount: 2, referenceCount: 1, recordedCount: 1, unknownCount: 1, untrackedCount: 1, reviewCount: 3 });
  });

  it("adds purchase status to text and CSV only when the caller supplies checked IDs", () => {
    const identifiedRows = rows.map((row, index) => ({ ...row, id: index === 0 ? "core-row" : "accessory-row" }));
    const checkedIds = new Set(["core-row"]);
    const text = purchaseListTextFor(identifiedRows, checkedIds);
    const csv = purchaseListCsvFor(identifiedRows, checkedIds);

    expect(text).toContain("[구매 완료] CPU: 테스트, CPU");
    expect(text).toContain("[구매 예정] 쿨링팬: 가격 미확인 팬");
    expect(csv).toContain("원문 링크,구매 상태");
    expect(csv).toContain("https://prod.danawa.com/info/?pcode=1,구매 완료");
    expect(csv).toContain("신품·정식 유통,오래된 정보,,,구매 예정");
    const stagedText = purchaseListTextFor(identifiedRows, checkedIds, [{ rowKey: "core-row", status: "ordered", updatedAt: "2026-09-04T00:00:00.000Z" }]);
    const stagedCsv = purchaseListCsvFor(identifiedRows, checkedIds, [{ rowKey: "core-row", status: "ordered", updatedAt: "2026-09-04T00:00:00.000Z" }]);
    expect(stagedText).toContain("[주문 완료] CPU: 테스트, CPU");
    expect(stagedCsv).toContain("https://prod.danawa.com/info/?pcode=1,주문 완료");
  });
});
