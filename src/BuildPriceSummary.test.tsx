import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import { BuildPriceSummaryPanel } from "./BuildPriceSummary";

const completeSnapshot: BuildPriceSnapshot = {
  coreTotalPriceWon: 900_000,
  accessoryTotalPriceWon: 100_000,
  totalPriceWon: 1_000_000,
  corePriceComplete: true,
  accessoryPriceComplete: true,
  priceComplete: true,
  unknownPriceCount: 0
};

describe("BuildPriceSummaryPanel", () => {
  it("separates a known numeric total from prices that need a purchase-time check", () => {
    const html = renderToStaticMarkup(createElement(BuildPriceSummaryPanel, {
      snapshot: { ...completeSnapshot, priceEvidenceReviewCount: 2 },
      budgetWon: 1_500_000
    }));

    expect(html).toContain("1,000,000원");
    expect(html).toContain("가격 확인 필요 2종 · 구매 전 다시 확인해 주세요");
    expect(html).toContain("표시 합계에는 확인을 다시 해야 할 가격 2종이 포함돼 있어요.");
    expect(html).not.toContain("가격 정보가 없는 부품이 있어요");
  });

  it("says when a selected item has no numeric price", () => {
    const html = renderToStaticMarkup(createElement(BuildPriceSummaryPanel, {
      snapshot: { ...completeSnapshot, totalPriceWon: 900_000, priceComplete: false, unknownPriceCount: 1 },
      budgetWon: 1_500_000
    }));

    expect(html).toContain("가격 정보가 없는 부품이 있어요");
    expect(html).toContain("가격이 없는 부품은 합계에 포함되지 않았어요.");
  });
});
