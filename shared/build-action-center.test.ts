import { describe, expect, it } from "vitest";
import type { BuildSelection, CompatibilityResult, Finding, Part } from "./types";
import { buildActionCenterFor } from "./build-action-center";
import { actionChecklistProgressFor, checkedChecklistIdsAfterAction, checklistItemIdsForAction } from "./build-action-links";

function baseResult(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    findings: [],
    metrics: {},
    analysis: { profile: "general", scoreLabel: "계산 불가", scoreBasis: "테스트", confidence: "unknown", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
    links: [],
    totalPriceWon: 100_000,
    priceComplete: true,
    engineVersion: "test",
    catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
    checkedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function finding(ruleId: string, severity: Finding["severity"]): Finding {
  return { id: ruleId, ruleId, severity, title: `${ruleId} 제목`, message: `${ruleId} 메시지`, affectedPartIds: [], facts: [], actions: [] };
}

describe("build action center", () => {
  it("puts blocker findings before review actions", () => {
    const center = buildActionCenterFor(baseResult({ blockerCount: 1, unknownCount: 1, findings: [finding("review-rule", "unknown"), finding("blocker-rule", "blocker")] }));

    expect(center.state).toBe("blocked");
    expect(center.actions.map((action) => action.id).slice(0, 2)).toEqual(["finding:blocker-rule", "finding:review-rule"]);
  });

  it("deduplicates repeated findings by rule id", () => {
    const center = buildActionCenterFor(baseResult({ warningCount: 2, findings: [finding("same-rule", "warning"), finding("same-rule", "warning")] }));

    expect(center.actions.filter((action) => action.id === "finding:same-rule")).toHaveLength(1);
    expect(center.totalCount).toBe(1);
  });

  it("adds data freshness and price actions without changing compatibility status", () => {
    const center = buildActionCenterFor(baseResult({ dataHealth: { selectedCount: 1, selectedQuantity: 1, freshCount: 0, agingCount: 0, staleCount: 1, unknownFreshnessCount: 0, incompleteCount: 1, unpricedCount: 1, overall: "needs_refresh", items: [{ id: "gpu-1", name: "테스트 GPU", category: "gpu", dataQuality: "incomplete", missingFields: ["lengthMm"], priceKnown: false, freshness: "stale" }] } }));

    expect(center.state).toBe("review");
    expect(center.actions.map((action) => action.id)).toEqual(expect.arrayContaining(["data-freshness:gpu-1", "data-fields:gpu-1", "data-price:gpu-1"]));
  });

  it("adds separate physical actions for case clearance and PSU cable topology", () => {
    const center = buildActionCenterFor(baseResult({ gpuFit: { status: "needs_review", length: { status: "compatible" }, thickness: { status: "compatible", warningThresholdMm: 55 }, power: { status: "compatible" }, physical: { status: "compatible", gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, caseSidePanelClearanceMm: 50 }, connector: { status: "compatible", options: [[{ kind: "pcie_8pin_6plus2", count: 2 }]], requirementsKnown: true, adapterOptionIndices: [], connectors: { pcie_8pin_6plus2: 2 }, psuCableTopologyStatus: "needs_review", psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "shared", optionFits: [] } } }));

    expect(center.actions.map((action) => action.id)).toEqual(expect.arrayContaining(["physical:psu-cable"]));
    expect(center.actions.find((action) => action.id === "physical:psu-cable")?.targetId).toBe("gpu-fit-summary-panel");
  });

  it("adds connectivity actions only for unrepresented review items and links them to the checklist", () => {
    const build: BuildSelection = { motherboard: { partId: "board-1", quantity: 1 }, case: { partId: "case-1", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true };
    const partMap = new Map<string, Part>([
      ["board-1", { id: "board-1", category: "motherboard", name: "테스트 보드", source: "seed", specs: { fanPortCount: 2, rgbPortCount: 1, rgb5vPortCount: 1, rgb12vPortCount: 0 }, dataQuality: "seed", missingFields: [], updatedAt: "2026-09-01T00:00:00.000Z" }],
      ["case-1", { id: "case-1", category: "case", name: "테스트 케이스", source: "seed", specs: { fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "12V" }, dataQuality: "seed", missingFields: [], updatedAt: "2026-09-01T00:00:00.000Z" }]
    ]);
    const center = buildActionCenterFor(baseResult(), build, partMap);

    expect(center.state).toBe("review");
    expect(center.actions.map((action) => action.id)).toEqual(expect.arrayContaining(["connectivity:fan-headers", "connectivity:rgb-headers", "connectivity:rgb-voltage"]));
    expect(center.actions.find((action) => action.id === "connectivity:fan-headers")).toMatchObject({ source: "physical", priority: "review", targetId: "build-connectivity-panel" });
    expect(checklistItemIdsForAction("connectivity:fan-headers")).toEqual(["connectivity:fan-headers"]);
    expect(actionChecklistProgressFor([{ id: "connectivity:fan-headers" }], new Set(["connectivity:fan-headers"]), new Set(["connectivity:fan-headers"]))).toEqual({ total: 1, checked: 1, percent: 100 });

    const engineCenter = buildActionCenterFor(baseResult({ warningCount: 1, findings: [finding("case-fan-headers", "warning")] }), build, partMap);
    expect(engineCenter.actions.map((action) => action.id)).toContain("finding:case-fan-headers");
    expect(engineCenter.actions.map((action) => action.id)).not.toContain("connectivity:fan-headers");
  });

  it("adds a review-only shortcut to the first repair plan when blockers exist", () => {
    const center = buildActionCenterFor(baseResult({ blockerCount: 1, findings: [finding("blocker-rule", "blocker")], repairPlans: [{ label: "최소 변경", title: "테스트 수리 플랜", changes: [], resolvedFindings: 1, resolvedFindingTitles: ["blocker-rule 제목"], resolvedBlockers: 1, resolvedUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, afterTotalPriceWon: 100_000, priceComplete: true, similarityScore: 90, similarityLabel: "유사", reason: "테스트", profileSummary: "테스트" }] }));

    expect(center.actions.find((action) => action.id === "repair:best-plan")).toMatchObject({ priority: "blocker", targetId: "repair-plan-panel" });
    expect(checklistItemIdsForAction("repair:best-plan")).toEqual(["repair:best-plan"]);
  });

  it("shows a final manual action when no engine or data action remains", () => {
    const center = buildActionCenterFor(baseResult());

    expect(center).toMatchObject({ state: "ready", totalCount: 1, hiddenCount: 0, actions: [{ id: "assembly:final-check", priority: "manual" }] });
    expect(checklistItemIdsForAction("assembly:final-check")).toEqual(["manual:post-build-test", "manual:manufacturer-support"]);
    expect(checklistItemIdsForAction("physical:psu-cable")).toEqual(["manual:pcie-cable-topology", "manual:power-cabling"]);
    expect(actionChecklistProgressFor([{ id: "physical:psu-cable" }, { id: "finding:socket" }, { id: "untracked" }], new Set(["manual:pcie-cable-topology", "manual:power-cabling", "finding:socket"]), new Set(["manual:pcie-cable-topology", "finding:socket"]))).toEqual({ total: 2, checked: 2, percent: 100 });
    expect(checkedChecklistIdsAfterAction(["unrelated"], "physical:psu-cable", new Set(["manual:pcie-cable-topology", "manual:power-cabling"]), true)).toEqual(["unrelated", "manual:pcie-cable-topology", "manual:power-cabling"]);
  });
});
