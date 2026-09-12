import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { catalogCategoryIntegrityReviewItemsFor, catalogCategoryIntegrityReviewPackageFor } from "./catalog-category-integrity-review";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "board-1",
    category: "motherboard",
    name: "정상 메인보드",
    source: "danawa",
    sourceProductCode: "1001",
    sourceCategoryId: "mainboard",
    danawaUrl: "https://prod.danawa.com/info/?pcode=1001",
    priceWon: 120_000,
    rawSpecText: "AMD(소켓AM5) / DDR5 / PCIe 슬롯",
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog category integrity review package", () => {
  it("exposes only mismatch records with source context and a bounded raw excerpt", () => {
    const longRawSpec = `  임베디드 보드\n${"원문 정보 ".repeat(80)}`;
    const items = catalogCategoryIntegrityReviewItemsFor([
      part({ id: "valid", name: "ASRock B650M 정상 메인보드" }),
      part({ id: "arduino", name: "아두이노 우노 호환보드", rawSpecText: "임베디드 보드" }),
      part({ id: "raspberry", name: "Raspberry Pi 5", rawSpecText: "ARM SBC" }),
      part({ id: "embedded", name: "개발 키트", rawSpecText: longRawSpec }),
      part({ id: "servo", name: "SG90 미니 서보모터", rawSpecText: "" })
    ]);

    expect(items.map((item) => item.partId)).toEqual(["raspberry", "arduino", "embedded", "servo"]);
    expect(items[0]).toMatchObject({
      partId: "raspberry",
      signal: "raspberry_pi",
      sourceProductCode: "1001",
      sourceCategoryId: "mainboard",
      sourceUrl: "https://prod.danawa.com/info/?pcode=1001",
      catalogUrl: "/catalog?category=motherboard&partId=raspberry"
    });
    expect(items.find((item) => item.partId === "embedded")?.rawSpecExcerpt).toHaveLength(360);
    expect(items.find((item) => item.partId === "embedded")?.rawSpecExcerpt?.endsWith("…")).toBe(true);
    expect(items.every((item) => item.category === "motherboard" && item.label.length > 0 && item.reason.length > 0)).toBe(true);
  });

  it("keeps pagination stable and reports the full queue fingerprint", () => {
    const catalog = [
      part({ id: "raspberry", name: "Raspberry Pi 5", rawSpecText: "ARM SBC" }),
      part({ id: "arduino", name: "Arduino Uno", rawSpecText: "개발 보드" }),
      part({ id: "embedded", name: "개발 키트", rawSpecText: "임베디드 보드" })
    ];

    const first = catalogCategoryIntegrityReviewPackageFor(catalog, { limit: 2, generatedAt: "2026-09-05T01:00:00.000Z" });
    const second = catalogCategoryIntegrityReviewPackageFor(catalog, { offset: first.nextOffset, limit: 2, generatedAt: "2026-09-05T01:00:00.000Z" });

    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: "catalog-category-integrity-review-package",
      generatedAt: "2026-09-05T01:00:00.000Z",
      ruleVersion: 1,
      checkedCount: 3,
      mismatchCount: 3,
      queueTotal: 3,
      includedCount: 2,
      remainingCount: 1,
      nextOffset: 2
    });
    expect(first.items.map((item) => item.partId)).toEqual(["raspberry", "arduino"]);
    expect(second.items.map((item) => item.partId)).toEqual(["embedded"]);
    expect(second.remainingCount).toBe(0);
    expect(second.nextOffset).toBeUndefined();
    expect(second.queueFingerprint).toBe(first.queueFingerprint);
  });

  it("changes the fingerprint when a review record changes", () => {
    const baseline = catalogCategoryIntegrityReviewPackageFor([part({ id: "arduino", name: "Arduino Uno", rawSpecText: "개발 보드" })], { generatedAt: "2026-09-05T01:00:00.000Z" });
    const changed = catalogCategoryIntegrityReviewPackageFor([part({ id: "arduino", name: "Arduino Uno R4", rawSpecText: "개발 보드", updatedAt: "2026-09-05T02:00:00.000Z" })], { generatedAt: "2026-09-05T01:00:00.000Z" });

    expect(changed.queueFingerprint).not.toBe(baseline.queueFingerprint);
  });
});
