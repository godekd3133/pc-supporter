import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildGenerationResult, Part } from "../shared/types";
import { gamingTierAssessmentFor } from "../shared/gaming-part-tiers";
import { GamingTierRequirementsPanel } from "./GamingTierRequirementsPanel";

function product(category: Part["category"], name: string, specs: Part["specs"]): Part {
  return { id: name, name, model: name, category, specs, source: "manual", priceWon: 100000, dataQuality: "manual", missingFields: [], updatedAt: "2026-10-05T00:00:00.000Z" };
}

function draft(): BuildGenerationResult {
  const assessment = gamingTierAssessmentFor({
    cpu: product("cpu", "AMD Ryzen 5600", { socket: "AM4", memoryType: "DDR4", tdpW: 65, pptW: 88, coolerIncluded: true }),
    motherboard: product("motherboard", "ASRock A520M-HVS 대원씨티에스", { socket: "AM4", memoryType: "DDR4", memorySlots: 2, maxMemoryGb: 64, formFactor: "mATX" }),
    memory: product("memory", "KLEVV DDR4 8GB", { memoryType: "DDR4", capacityGb: 8, memoryModuleCountPerKit: 1 }),
    gpu: product("gpu", "RTX 5070 Ti 16GB", { vramGb: 16, powerW: 300, recommendedPsuW: 750, lengthMm: 310, pciePowerOptions: [[{ kind: "12v2x6", count: 1 }]] }),
    psu: product("psu", "750W", { wattageW: 750 })
  }, { memoryQuantity: 2 });
  return {
    gamingTestbedPhase1: true, gamingSupportRequirements: assessment.requirements, partTierSuitability: assessment.categories,
    selection: { useIntegratedGraphics: false, cpu: { partId: "cpu", quantity: 1 }, memory: [], ssd: [], hdd: [] }, profile: "gaming", priority: "performance", gamingResolution: "1440p", gamingRefreshRate: 144,
    memoryCapacityGb: 16, budgetWon: 3_000_000, includeNonRetail: false, listingPolicy: "retail_only", storageCapacityGb: 1000, hddCount: 0,
    totalPriceWon: 2_000_000, budgetDeltaWon: -1_000_000, withinBudget: true, priceComplete: true, status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 1, lines: [], rationale: [], warnings: []
  };
}

describe("game quote minimum and appropriate configuration presentation", () => {
  it("shows the actual RAM total, minimum 16GB and appropriate 32GB for an upper GPU", () => {
    const markup = renderToStaticMarkup(createElement(GamingTierRequirementsPanel, { draft: draft() }));
    expect(markup).toContain("부품 선택 기준");
    expect(markup).toContain("16GB DDR4");
    expect(markup).toContain("32GB");
    expect(markup).toContain("권장보다 낮음");
    expect(markup).toContain('data-testid="gaming-tier-memory"');
  });

  it("renders a packaged included cooler without requiring an invented paid cooler row", () => {
    const markup = renderToStaticMarkup(createElement(GamingTierRequirementsPanel, { draft: draft() }));
    expect(markup).toContain("CPU에 포함된 기본 쿨러");
    expect(markup).toContain("기본 쿨러 포함");
    expect(markup).toContain('data-testid="gaming-tier-cooler"');
  });

  it("shows missing GPU power connectors as a check instead of claiming wattage alone is enough", () => {
    const markup = renderToStaticMarkup(createElement(GamingTierRequirementsPanel, { draft: draft() }));
    expect(markup).toContain("확인 필요");
    expect(markup).toContain("전원 커넥터 개수와 일치해야 합니다");
    expect(markup).toContain("호환성 검사 결과도 확인하세요");
  });

  it("omits the panel from older saved drafts without tier metadata", () => {
    const old = { ...draft(), gamingSupportRequirements: undefined, partTierSuitability: undefined };
    expect(renderToStaticMarkup(createElement(GamingTierRequirementsPanel, { draft: old }))).toBe("");
  });
});
