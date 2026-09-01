import { describe, expect, it } from "vitest";
import type { BudgetLadderExportItem } from "./budget-ladder";
import { budgetLadderVersionChangedRowsFor, budgetLadderVersionRequestText, budgetLadderVersionRowsFor } from "./budget-ladder-version-comparison";
import type { BudgetLadderShareSnapshot } from "./budget-ladder-share";

const request = {
  profile: "gaming" as const,
  budgetWon: 1_500_000,
  includeGpu: true,
  priority: "balanced" as const,
  gamingResolution: "1440p" as const,
  gamingRefreshRate: 144 as const,
  memoryCapacityGb: 32,
  storageCapacityGb: 1000,
  hddCount: 0,
  listingPolicy: "retail_only" as const
};

function item(id: "economy" | "target" | "headroom", overrides: Partial<BudgetLadderExportItem> = {}): BudgetLadderExportItem {
  return {
    id,
    label: id,
    description: id,
    budgetWon: id === "economy" ? 1_200_000 : id === "target" ? 1_500_000 : 1_800_000,
    status: "호환 가능",
    totalPriceWon: id === "economy" ? 900_000 : id === "target" ? 1_400_000 : 1_700_000,
    budgetDeltaWon: -100_000,
    withinBudget: true,
    priceComplete: true,
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    analysisScore: 70,
    lines: [{ category: "cpu", text: "같은 CPU" }],
    ...overrides
  };
}

function snapshot(id: string, versionNumber: number, targetOverrides: Partial<BudgetLadderExportItem> = {}): BudgetLadderShareSnapshot {
  return {
    id,
    name: `v${versionNumber}`,
    versionNumber,
    lineageId: "lineage-1",
    payload: {
      type: "pc-supporter-budget-ladder",
      version: 1,
      exportedAt: "2026-09-01T00:00:00.000Z",
      items: [item("economy"), item("target", targetOverrides), item("headroom")],
      changes: []
    },
    request,
    catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
    createdAt: `2026-09-0${versionNumber}T00:00:00.000Z`,
    updatedAt: `2026-09-0${versionNumber}T00:00:00.000Z`
  };
}

describe("budget ladder version comparison", () => {
  it("marks only result rows as changed and preserves metadata rows for full view", () => {
    const rows = budgetLadderVersionRowsFor([
      snapshot("v1", 1),
      snapshot("v2", 2, { totalPriceWon: 1_500_000, analysisScore: 82, lines: [{ category: "cpu", text: "새 CPU" }] }),
      snapshot("v3", 3, { totalPriceWon: 1_550_000, analysisScore: 84, lines: [{ category: "cpu", text: "최신 CPU" }] })
    ]);
    const changedRows = budgetLadderVersionChangedRowsFor(rows);

    expect(rows).toHaveLength(17);
    expect(rows.find((row) => row.id === "created")?.changed).toBe(true);
    expect(rows.find((row) => row.id === "created")?.diffable).toBe(false);
    expect(changedRows.map((row) => row.id)).toEqual(expect.arrayContaining(["total", "analysis", "cpu"]));
    expect(changedRows.some((row) => row.id === "created" || row.id === "catalog")).toBe(false);
    expect(budgetLadderVersionRequestText(request)).toContain("144Hz");
  });
});
