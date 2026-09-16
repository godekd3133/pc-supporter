import { describe, expect, it } from "vitest";
import { buildResourceSummaryFor } from "./build-resource-summary";

describe("build resource summary", () => {
  it("keeps the two resource budgets good when both comparison values have enough headroom", () => {
    const summary = buildResourceSummaryFor({
      gpuPowerW: 320,
      recommendedPsuW: 850,
      psuWattageW: 1000,
      powerHeadroomW: 150,
      cpuPowerW: 120,
      coolerCapacityW: 240,
      coolerHeadroomW: 120
    });

    expect(summary).toMatchObject({ state: "good", stateLabel: "여유 있음" });
    expect(summary.cards).toEqual([
      expect.objectContaining({ id: "power", state: "good", headline: "150W 여유", basis: "선택 PSU 정격 출력 - GPU 권장 PSU" }),
      expect.objectContaining({ id: "cooling", state: "good", headline: "120W 여유", basis: "쿨러 냉각 지원 - CPU TDP/PPT 기준" })
    ]);
  });

  it("flags narrow headroom even when it is still non-negative", () => {
    const summary = buildResourceSummaryFor({ powerHeadroomW: 100, coolerHeadroomW: 20, psuWattageW: 850, recommendedPsuW: 750, coolerCapacityW: 160, cpuPowerW: 140 });

    expect(summary.state).toBe("warning");
    expect(summary.summary).toContain("여유가 좁아");
    expect(summary.cards.map((card) => card.state)).toEqual(["warning", "warning"]);
  });

  it("treats a negative budget as a hard failure", () => {
    const summary = buildResourceSummaryFor({ powerHeadroomW: -100, coolerHeadroomW: 40, psuWattageW: 750, recommendedPsuW: 850, coolerCapacityW: 180, cpuPowerW: 140 });

    expect(summary.state).toBe("danger");
    expect(summary.cards[0]).toMatchObject({ state: "danger", headline: "100W 부족" });
    expect(summary.cards[1]).toMatchObject({ state: "warning", headline: "40W 여유" });
  });

  it("does not infer safety from partial data", () => {
    const summary = buildResourceSummaryFor({ gpuPowerW: 320, cpuPowerW: 120 });

    expect(summary.state).toBe("unknown");
    expect(summary.cards).toEqual([
      expect.objectContaining({ id: "power", state: "unknown", headline: "확인 필요" }),
      expect.objectContaining({ id: "cooling", state: "unknown", headline: "확인 필요" })
    ]);
    expect(summary.summary).toContain("안전하다고 보지 않아요");
  });

  it("keeps an empty build neutral", () => {
    const summary = buildResourceSummaryFor({});

    expect(summary.state).toBe("neutral");
    expect(summary.cards.map((card) => card.headline)).toEqual(["미적용", "미적용"]);
  });
});
