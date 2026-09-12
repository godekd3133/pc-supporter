import { describe, expect, it } from "vitest";
import type { BuildSelection, CompatibilityResult } from "./types";
import { assemblyPlanFor, assemblyPlanNextStepFor } from "./assembly-plan";

const build: BuildSelection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    findings: [],
    metrics: {},
    analysis: { profile: "general", scoreLabel: "계산 불가", scoreBasis: "테스트", confidence: "unknown", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
    dataHealth: { selectedCount: 0, selectedQuantity: 0, freshCount: 0, agingCount: 0, staleCount: 0, unknownFreshnessCount: 0, incompleteCount: 0, unpricedCount: 0, overall: "verified", items: [] },
    links: [],
    totalPriceWon: 100_000,
    priceComplete: true,
    engineVersion: "test",
    catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
    checkedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("assembly plan", () => {
  it("blocks purchase and keeps assembly steps pending when a compatibility blocker remains", () => {
    const plan = assemblyPlanFor(build, result({ status: "incompatible", blockerCount: 1 }));

    expect(plan.state).toBe("blocked");
    expect(plan.steps.find((step) => step.id === "resolve-conflicts")).toMatchObject({ status: "blocked", targetId: "repair-plan-panel" });
    expect(plan.steps.find((step) => step.id === "confirm-evidence")).toMatchObject({ status: "pending", targetId: "repair-plan-panel" });
    expect(plan.steps.find((step) => step.id === "confirm-purchase")).toMatchObject({ status: "blocked" });
    expect(plan.steps.find((step) => step.id === "bench-assemble")).toMatchObject({ status: "pending" });
    expect(plan.steps.find((step) => step.id === "post-build-test")).toMatchObject({ status: "pending" });
    expect(plan.steps.find((step) => step.id === "resolve-conflicts")?.targetId).toBe("repair-plan-panel");
  });

  it("keeps the purchase step reviewable and does not unlock assembly after a warning", () => {
    const plan = assemblyPlanFor(build, result({ status: "needs_review", warningCount: 1 }));

    expect(plan.state).toBe("review");
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "resolve-conflicts", status: "review" }),
      expect.objectContaining({ id: "confirm-purchase", status: "review" }),
      expect.objectContaining({ id: "bench-assemble", status: "pending" }),
      expect.objectContaining({ id: "wire-peripherals", status: "pending" })
    ]));
  });

  it("unlocks the full sequence only when compatibility, evidence, and price gates are clear", () => {
    const plan = assemblyPlanFor(build, result());

    expect(plan.state).toBe("ready");
    expect(plan.steps.every((step) => step.status === "ready")).toBe(true);
    expect(plan.steps.find((step) => step.id === "post-build-test")?.targetId).toBe("assembly-verification-panel");
    expect(plan.steps.map((step) => step.id)).toEqual([
      "resolve-conflicts",
      "confirm-evidence",
      "confirm-purchase",
      "bench-assemble",
      "wire-peripherals",
      "post-build-test"
    ]);
  });

  it("routes accessory review to the peripheral compatibility panel", () => {
    const accessoryBuild: BuildSelection = { ...build, accessories: [{ accessoryId: "fan", quantity: 1 }] };
    const plan = assemblyPlanFor(accessoryBuild, result({ accessoryCompatibility: { status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 1, findings: [] } }));

    expect(plan.steps.find((step) => step.id === "wire-peripherals")).toMatchObject({ status: "pending", targetId: "accessory-compatibility-panel" });
    expect(plan.summary).toContain("원문·가격·연결 근거");
  });

  it("routes a calculated resource-budget review to the resource summary", () => {
    const plan = assemblyPlanFor(build, result({ metrics: { powerHeadroomW: 100, psuWattageW: 850, recommendedPsuW: 750 } }));

    expect(plan.state).toBe("review");
    expect(plan.steps.find((step) => step.id === "confirm-evidence")).toMatchObject({ status: "review", targetId: "build-resource-summary" });
  });

  it("keeps assembly steps waiting until recorded purchase and checklist progress is ready", () => {
    const plan = assemblyPlanFor(build, result(), {
      checklistProgress: { total: 4, checked: 1, remaining: 3, percent: 25 },
      purchaseProgress: { total: 3, checked: 0, remaining: 3, percent: 0, stageCounts: { planned: 2, ordered: 1, received: 0, installed: 0 } }
    });
    expect(plan.state).toBe("review");
    expect(plan.steps.find((step) => step.id === "confirm-evidence")).toMatchObject({ status: "review", progress: { label: "체크리스트 1/4개", percent: 25 } });
    expect(plan.steps.find((step) => step.id === "confirm-purchase")).toMatchObject({ status: "review", progress: { label: "수령·조립 0/3개", percent: 0 } });
    expect(plan.steps.find((step) => step.id === "bench-assemble")?.status).toBe("pending");
    expect(plan.summary).toContain("구매 항목 3개");
  });

  it("surfaces recorded assembly verification progress without turning missing measurements into a pass", () => {
    const plan = assemblyPlanFor(build, result(), {
      purchaseProgress: { total: 3, checked: 3, remaining: 0, percent: 100, stageCounts: { planned: 0, ordered: 0, received: 0, installed: 3 } },
      assemblyVerification: { state: "in_progress", checked: 2, total: 6, passed: 2, failed: 0, remaining: 4, percent: 33, recheckSignalCount: 0, updatedAt: "2026-09-04T00:00:00.000Z" }
    });
    expect(plan.steps.find((step) => step.id === "post-build-test")).toMatchObject({ status: "review", progress: { label: "실측 2/6개", percent: 33 } });
    expect(plan.steps.find((step) => step.id === "post-build-test")?.summary).toContain("실측 기록을 완료");
  });

  it("selects the first non-ready step as the resume target and falls back to the final step", () => {
    const blockedPlan = assemblyPlanFor(build, result({ status: "incompatible", blockerCount: 1 }));
    expect(assemblyPlanNextStepFor(blockedPlan)).toMatchObject({ id: "resolve-conflicts", status: "blocked", targetId: "repair-plan-panel" });
    const readyPlan = assemblyPlanFor(build, result());
    expect(assemblyPlanNextStepFor(readyPlan)).toMatchObject({ id: "post-build-test", status: "ready", targetId: "assembly-verification-panel" });
  });
});
