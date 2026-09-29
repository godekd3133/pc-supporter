import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccessoryItem, AccessoryRecommendation } from "../shared/types";
import { AccessoryRecommendationComparison } from "./ResultPanels";

describe("AccessoryRecommendationComparison", () => {
  it("shows collection state and unknown specs instead of claiming there are no required gaps", () => {
    const item: AccessoryItem = {
      id: "storage-adapter-missing-pcie-width",
      category: "storage_accessory",
      name: "M.2 to PCIe adapter",
      source: "danawa",
      listingType: "accessory",
      rawSpecText: "M.2 NVMe SSD to PCIe adapter",
      specs: { interface: "NVMe", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"] },
      dataQuality: "live",
      missingFields: [],
      updatedAt: "2026-09-29T00:00:00.000Z"
    };
    const recommendation: AccessoryRecommendation = {
      id: item.id,
      category: item.category,
      item,
      priority: "recommended",
      confidence: "medium",
      reason: "M.2 SSD 어댑터 규격이 맞습니다.",
      fitBasis: "지원 규격 확인"
    };

    const html = renderToStaticMarkup(createElement(AccessoryRecommendationComparison, { recommendations: [recommendation] }));

    expect(html).toContain("수집 상태");
    expect(html).toContain("다나와 상세 수집");
    expect(html).not.toContain("필수 누락");
    expect(html).toContain("PCIe 요구 슬롯 폭");
    expect(html).toContain("정보 부족");
  });
});
