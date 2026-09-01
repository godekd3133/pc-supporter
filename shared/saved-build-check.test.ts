import { describe, expect, it } from "vitest";
import type { CompatibilityResult } from "./types";
import { assemblyVerificationSavedSnapshotFor, emptyAssemblyVerificationLog, withAssemblyVerificationCheck } from "./assembly-verification";
import { appendSavedBuildCheckHistory, SAVED_BUILD_CHECK_FINDING_LIMIT, savedBuildCheckDiffFor, savedBuildCheckFindingDiffFor, savedBuildCheckHistoryFromUnknown, savedBuildCheckSnapshotFor, savedBuildCheckSnapshotFromUnknown, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 1,
    unknownCount: 0,
    findings: [],
    metrics: {} as CompatibilityResult["metrics"],
    analysis: {
      profile: "general",
      overallScore: 82,
      scoreLabel: "상위권",
      scoreBasis: "테스트 기준",
      confidence: "high",
      factors: [],
      strengths: [],
      focusAreas: [],
      bottlenecks: [],
      nextActions: []
    },
    links: [],
    totalPriceWon: 1_250_000,
    priceComplete: true,
    engineVersion: "2.53.0",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:01:00.000Z",
    ...overrides
  };
}

describe("saved build check snapshots", () => {
  it("keeps a compact, share-safe summary of a full compatibility result", () => {
    const snapshot = savedBuildCheckSnapshotFor(result({
      coreTotalPriceWon: 1_100_000,
      corePriceComplete: true,
      accessoryTotalPriceWon: 150_000,
      accessoryPriceComplete: true,
      findings: []
    }));

    expect(snapshot).toEqual({
      status: "compatible",
      blockerCount: 0,
      warningCount: 1,
      unknownCount: 0,
      totalPriceWon: 1_250_000,
      priceComplete: true,
      coreTotalPriceWon: 1_100_000,
      corePriceComplete: true,
      accessoryTotalPriceWon: 150_000,
      accessoryPriceComplete: true,
      findings: [],
      analysisScore: 82,
      analysisScoreLabel: "상위권",
      analysisConfidence: "high",
      actionCenterState: "review",
      actionCenterSummary: "호환성은 진행할 수 있지만 구매·조립 전에 확인할 항목 1개가 있습니다.",
      actionCenterTotalCount: 1,
      engineVersion: "2.53.0",
      catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
      checkedAt: "2026-08-31T00:01:00.000Z"
    });
    expect("findings" in snapshot).toBe(true);
  });

  it("accepts valid persisted data and rejects malformed snapshot data", () => {
    const snapshot = savedBuildCheckSnapshotFor(result());
    expect(savedBuildCheckSnapshotFromUnknown(snapshot)).toEqual(snapshot);
    expect(savedBuildCheckSnapshotFromUnknown({ ...snapshot, blockerCount: -1 })).toBeUndefined();
    expect(savedBuildCheckSnapshotFromUnknown({ ...snapshot, analysisScore: 101 })).toBeUndefined();
    expect(savedBuildCheckSnapshotFromUnknown({ ...snapshot, status: "unknown" })).toBeUndefined();
  });

  it("keeps the compact assembly verification summary in saved check history", () => {
    const log = withAssemblyVerificationCheck(emptyAssemblyVerificationLog("build-fingerprint"), "post", "pass");
    const verification = assemblyVerificationSavedSnapshotFor(log);
    const snapshot = { ...savedBuildCheckSnapshotFor(result()), assemblyVerification: verification };

    expect(savedBuildCheckSnapshotFromUnknown(snapshot)).toEqual(snapshot);
    expect(savedBuildCheckSnapshotFromUnknown({ ...snapshot, assemblyVerification: { ...verification, checked: 6 } })).toBeUndefined();
  });

  it("persists peripheral compatibility risk and detects it in saved-check drift", () => {
    const peripheralResult = result({
      accessoryCompatibility: {
        status: "needs_review",
        blockerCount: 0,
        warningCount: 1,
        unknownCount: 0,
        findings: [{
          id: "accessory-finding",
          ruleId: "accessory-storage-adapter",
          severity: "warning",
          accessoryId: "adapter-1",
          accessoryName: "M.2 SATA 어댑터",
          relatedPartIds: ["ssd-1"],
          title: "어댑터 인터페이스 확인 필요",
          message: "NVMe 신호 지원을 확인하세요.",
          facts: [{ label: "선택 SSD", actual: "NVMe" }],
          action: "제조사 원문 확인"
        }]
      }
    });
    const snapshot = savedBuildCheckSnapshotFor(peripheralResult);
    expect(snapshot.accessoryCompatibility).toMatchObject({ status: "needs_review", warningCount: 1, findings: [expect.objectContaining({ accessoryName: "M.2 SATA 어댑터", action: "제조사 원문 확인" })] });
    expect(savedBuildCheckSnapshotFromUnknown(snapshot)).toEqual(snapshot);
    expect(savedBuildCheckSnapshotFromUnknown({ ...snapshot, accessoryCompatibility: { ...snapshot.accessoryCompatibility!, blockerCount: -1 } })).toBeUndefined();
    expect(savedBuildCheckDiffFor(snapshot, result())).toMatchObject({ accessoryRiskChanged: true, riskChanged: true });
    expect(savedBuildCheckTransitionSummaryFor(savedBuildCheckSnapshotFor(result()), snapshot)).toMatchObject({ accessoryWarningDelta: 1, accessoryRiskChanged: true, hasChanges: true });
  });

  it("bounds rule summaries so a long inspection history stays share-safe", () => {
    const longText = "x".repeat(500);
    const snapshot = savedBuildCheckSnapshotFor(result({ findings: Array.from({ length: SAVED_BUILD_CHECK_FINDING_LIMIT + 4 }, (_, index) => ({
      id: `finding-${index}`,
      ruleId: `rule-${index}`,
      severity: "warning" as const,
      title: longText,
      message: longText,
      affectedPartIds: Array.from({ length: 12 }, (_, partIndex) => `part-${partIndex}`),
      facts: Array.from({ length: 7 }, (_, factIndex) => ({ label: `fact-${factIndex}`, actual: longText, expected: longText })),
      actions: []
    })) }));
    expect(snapshot.findings).toHaveLength(SAVED_BUILD_CHECK_FINDING_LIMIT);
    expect(snapshot.findings?.[0].title.length).toBeLessThanOrEqual(160);
    expect(snapshot.findings?.[0].message.length).toBeLessThanOrEqual(240);
    expect(snapshot.findings?.[0].affectedPartIds).toHaveLength(8);
    expect(snapshot.findings?.[0].facts).toHaveLength(4);
  });

  it("reports drift between the saved check and the current catalog check", () => {
    const snapshot = savedBuildCheckSnapshotFor(result());
    expect(savedBuildCheckDiffFor(snapshot, result())).toMatchObject({ hasChanges: false });
    expect(savedBuildCheckDiffFor(snapshot, result({ status: "needs_review", unknownCount: 2, totalPriceWon: 1_300_000, catalogSnapshotAt: "2026-09-01T00:00:00.000Z" }))).toMatchObject({
      statusChanged: true,
      riskChanged: true,
      priceChanged: true,
      catalogChanged: true,
      hasChanges: true
    });
  });

  it("keeps the latest twenty valid history entries and uses the newest entry as the append target", () => {
    const snapshots = Array.from({ length: 22 }, (_, index) => savedBuildCheckSnapshotFor(result({
      checkedAt: `2026-08-31T00:${String(index).padStart(2, "0")}:00.000Z`,
      totalPriceWon: 1_250_000 + index
    })));
    const parsed = savedBuildCheckHistoryFromUnknown([snapshots[0], { broken: true }, ...snapshots.slice(1)]);
    expect(parsed).toHaveLength(20);
    expect(parsed[0].checkedAt).toBe(snapshots[2].checkedAt);
    expect(parsed[19].checkedAt).toBe(snapshots[21].checkedAt);
    const next = savedBuildCheckSnapshotFor(result({ checkedAt: "2026-09-01T00:00:00.000Z" }));
    expect(appendSavedBuildCheckHistory(parsed, next)).toHaveLength(20);
    expect(appendSavedBuildCheckHistory(parsed, next).at(-1)).toEqual(next);
  });

  it("classifies rule-level findings as resolved, new, changed, or unchanged", () => {
    const before = savedBuildCheckSnapshotFor(result({ findings: [
      { id: "socket", ruleId: "cpu-motherboard-socket", severity: "blocker", title: "소켓 오류", message: "AM5가 필요합니다.", affectedPartIds: ["cpu-1", "mb-1"], facts: [{ label: "소켓", actual: "LGA1700", expected: "AM5" }], actions: [] },
      { id: "ram-speed", ruleId: "memory-speed", severity: "warning", title: "RAM 속도", message: "다운클럭될 수 있습니다.", affectedPartIds: ["ram-1"], facts: [], actions: [] },
      { id: "power", ruleId: "gpu-psu-power", severity: "blocker", title: "전력 부족", message: "파워가 부족합니다.", affectedPartIds: ["gpu-1", "psu-1"], facts: [], actions: [] }
    ] }));
    const after = savedBuildCheckSnapshotFor(result({ findings: [
      { id: "ram-speed", ruleId: "memory-speed", severity: "info", title: "RAM 속도", message: "현재 속도로 동작합니다.", affectedPartIds: ["ram-1"], facts: [], actions: [] },
      { id: "new-case", ruleId: "case-gpu-clearance", severity: "warning", title: "케이스 여유", message: "장착 공간을 확인해 주세요.", affectedPartIds: ["case-1", "gpu-1"], facts: [], actions: [] }
    ] }));
    const diff = savedBuildCheckFindingDiffFor(before, after);
    expect(diff.available).toBe(true);
    expect(diff.changes.map((item) => [item.key, item.change])).toEqual([
      ["cpu-motherboard-socket", "resolved"],
      ["gpu-psu-power", "resolved"],
      ["case-gpu-clearance", "new"],
      ["memory-speed", "severity_changed"]
    ]);
    const detailChanged = savedBuildCheckFindingDiffFor(
      savedBuildCheckSnapshotFor(result({ findings: [{ id: "memory", ruleId: "memory-speed", severity: "warning", title: "RAM 속도", message: "다운클럭될 수 있습니다.", affectedPartIds: ["ram-1"], facts: [], actions: [] }] })),
      savedBuildCheckSnapshotFor(result({ findings: [{ id: "different-id", ruleId: "memory-speed", severity: "warning", title: "RAM 속도", message: "현재 속도로 동작합니다.", affectedPartIds: ["ram-2"], facts: [], actions: [] }] }))
    );
    expect(detailChanged.changes[0].change).toBe("details_changed");
    const legacySnapshot = savedBuildCheckSnapshotFromUnknown({ ...before, findings: undefined });
    expect(legacySnapshot).toBeDefined();
    expect(savedBuildCheckFindingDiffFor(legacySnapshot!, after).available).toBe(false);
  });

  it("summarizes transition direction, count deltas, price, and finding changes", () => {
    const before = savedBuildCheckSnapshotFor(result({ status: "incompatible", blockerCount: 2, warningCount: 1, unknownCount: 0, totalPriceWon: 1_000_000, findings: [{ id: "socket", ruleId: "cpu-motherboard-socket", severity: "blocker", title: "소켓 오류", message: "소켓이 다릅니다.", affectedPartIds: ["cpu", "mb"], facts: [], actions: [] }] }));
    const after = savedBuildCheckSnapshotFor(result({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 950_000, findings: [] }));
    expect(savedBuildCheckTransitionSummaryFor(before, after)).toMatchObject({ direction: "improved", blockerDelta: -2, warningDelta: -1, priceDeltaWon: -50_000, resolvedFindingCount: 1, hasChanges: true });
    const regressed = savedBuildCheckTransitionSummaryFor(after, before);
    expect(regressed).toMatchObject({ direction: "regressed", blockerDelta: 2, priceDeltaWon: 50_000 });
    const changed = savedBuildCheckTransitionSummaryFor(savedBuildCheckSnapshotFor(result({ findings: [] })), savedBuildCheckSnapshotFor(result({ findings: [{ id: "ram", ruleId: "memory-speed", severity: "warning", title: "RAM 속도", message: "변경된 설명", affectedPartIds: [], facts: [], actions: [] }] })));
    expect(changed).toMatchObject({ direction: "changed", newFindingCount: 1, hasChanges: true });
  });
});
