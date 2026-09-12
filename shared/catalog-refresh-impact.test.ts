import { describe, expect, it } from "vitest";
import { catalogRefreshFindingImpactsFor } from "./catalog-refresh-impact";

const report = {
  inputFingerprint: "fingerprint",
  status: "success" as const,
  requestedCount: 1,
  successCount: 1,
  failureCount: 0,
  items: [{ target: { kind: "part" as const, id: "gpu-1" }, name: "GPU", changedFields: ["가격"], refreshedAt: "2026-09-04T00:00:00.000Z", previousDataQuality: "live" as const, nextDataQuality: "live" as const, previousMissingCount: 0, nextMissingCount: 0 }],
  failures: [],
  completedAt: "2026-09-04T00:00:00.000Z"
};

describe("catalog refresh finding impact", () => {
  it("connects only changed findings whose affected part ids overlap the refreshed item", () => {
    const impacts = catalogRefreshFindingImpactsFor(report, [
      { key: "gpu-power", change: "resolved", before: { id: "1", ruleId: "gpu-power", severity: "blocker", title: "GPU 전력", message: "전력 부족", affectedPartIds: ["gpu-1"], facts: [] } },
      { key: "case-size", change: "new", after: { id: "2", ruleId: "case-size", severity: "warning", title: "케이스", message: "확인", affectedPartIds: ["case-1"], facts: [] } },
      { key: "unchanged-gpu", change: "unchanged", before: { id: "3", ruleId: "unchanged-gpu", severity: "info", title: "정보", message: "같음", affectedPartIds: ["gpu-1"], facts: [] }, after: { id: "3", ruleId: "unchanged-gpu", severity: "info", title: "정보", message: "같음", affectedPartIds: ["gpu-1"], facts: [] } }
    ]);

    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.findingChanges.map((change) => change.key)).toEqual(["gpu-power"]);
  });

  it("returns a no-linked-change result without manufacturing causality", () => {
    const impacts = catalogRefreshFindingImpactsFor(report, [{ key: "cpu", change: "details_changed", before: { id: "1", ruleId: "cpu", severity: "warning", title: "CPU", message: "변경 전", affectedPartIds: ["cpu-1"], facts: [] }, after: { id: "1", ruleId: "cpu", severity: "warning", title: "CPU", message: "변경 후", affectedPartIds: ["cpu-1"], facts: [] } }]);

    expect(impacts[0]?.findingChanges).toEqual([]);
  });
});
