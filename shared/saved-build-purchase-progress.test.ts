import { describe, expect, it } from "vitest";
import { savedBuildPurchaseProgressComparisonRowsFor, savedBuildPurchaseProgressMatchesFilter, savedBuildPurchaseProgressSummaryFor } from "./saved-build-purchase-progress";

const baseProgress = {
  inputFingerprint: "fingerprint",
  rowKeys: ["cpu", "gpu", "ram"],
  checkedIds: ["cpu"],
  revision: 2,
  updatedAt: "2026-09-02T00:00:00.000Z"
};

describe("saved build purchase progress summary", () => {
  it("summarizes unrecorded, in-progress, and completed server states for list filters", () => {
    const unrecorded = savedBuildPurchaseProgressSummaryFor(undefined);
    const inProgress = savedBuildPurchaseProgressSummaryFor(baseProgress);
    const completed = savedBuildPurchaseProgressSummaryFor({ ...baseProgress, checkedIds: ["cpu", "gpu", "ram"], revision: 3, history: [baseProgress] });
    expect(unrecorded).toMatchObject({ status: "unrecorded", checked: 0, total: 0, percent: 0, historyCount: 0 });
    expect(unrecorded.stageCounts).toEqual({ planned: 0, ordered: 0, received: 0, installed: 0 });
    expect(inProgress).toMatchObject({ status: "in-progress", checked: 1, total: 3, remaining: 2, percent: 33, revision: 2, stageCounts: { planned: 2, ordered: 0, received: 1, installed: 0 } });
    expect(completed).toMatchObject({ status: "completed", checked: 3, total: 3, remaining: 0, percent: 100, revision: 3, historyCount: 1 });
    expect(completed.stageCounts).toMatchObject({ planned: 0, ordered: 0, received: 3, installed: 0 });
    expect(savedBuildPurchaseProgressMatchesFilter(unrecorded, "unrecorded")).toBe(true);
    expect(savedBuildPurchaseProgressMatchesFilter(inProgress, "recorded")).toBe(true);
    expect(savedBuildPurchaseProgressMatchesFilter(inProgress, "completed")).toBe(false);
    expect(savedBuildPurchaseProgressMatchesFilter(completed, "completed")).toBe(true);
    expect(savedBuildPurchaseProgressComparisonRowsFor([{ id: "build-a", name: "견적 A", purchaseProgress: baseProgress }, { id: "build-b", name: "견적 B" }])).toMatchObject([
      { id: "build-a", summary: { status: "in-progress", checked: 1, total: 3 } },
      { id: "build-b", summary: { status: "unrecorded" } }
    ]);
  });
});
