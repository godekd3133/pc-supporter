import { describe, expect, it } from "vitest";
import type { BuildSelection, CompatibilityResult } from "./types";
import { assemblyPlanFor } from "./assembly-plan";

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
});
