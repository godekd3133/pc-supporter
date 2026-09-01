import { describe, expect, it } from "vitest";
import type { BuildSelection, RecommendationPlan } from "./types";
import { repairPlanPerformanceRetentionFor } from "./repair-plan-performance";

const build: BuildSelection = {
  cpu: { partId: "cpu", quantity: 1 },
  motherboard: { partId: "motherboard", quantity: 1 },
  memory: [{ partId: "memory", quantity: 2 }],
  gpu: { partId: "gpu", quantity: 1 },
  ssd: [{ partId: "ssd", quantity: 1 }],
  hdd: [],
  accessories: [],
  useIntegratedGraphics: false
};

function plan(...categories: RecommendationPlan["changes"][number]["category"][]) {
  return { changes: categories.map((category) => ({ category })) } as RecommendationPlan;
}

describe("repair plan performance retention", () => {
  it("identifies CPU and GPU retention when only case or PSU changes", () => {
    expect(repairPlanPerformanceRetentionFor(build, plan("case", "psu"))).toEqual({
      status: "preserved",
      retainedCategories: ["cpu", "gpu", "memory", "ssd"],
      changedCategories: [],
      summary: "카탈로그 성능 기준 유지 · CPU · GPU · RAM · SSD"
    });
  });

  it("separates preserved performance anchors from changed memory or GPU", () => {
    expect(repairPlanPerformanceRetentionFor(build, plan("case", "memory"))).toMatchObject({
      status: "mixed",
      retainedCategories: ["cpu", "gpu", "ssd"],
      changedCategories: ["memory"],
      summary: "성능 기준 유지 · CPU · GPU · SSD · 변경 · RAM"
    });
    expect(repairPlanPerformanceRetentionFor(build, plan("gpu"))).toMatchObject({
      status: "mixed",
      retainedCategories: ["cpu", "memory", "ssd"],
      changedCategories: ["gpu"]
    });
  });

  it("does not claim a performance baseline when no performance category is selected", () => {
    const emptyBuild: BuildSelection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

    expect(repairPlanPerformanceRetentionFor(emptyBuild, plan("case"))).toEqual({
      status: "unknown",
      retainedCategories: [],
      changedCategories: [],
      summary: "카탈로그 성능 기준 비교 불가"
    });
  });
});
