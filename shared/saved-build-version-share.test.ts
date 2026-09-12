import { describe, expect, it } from "vitest";
import { SAVED_BUILD_VERSION_SHARE_KIND, SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION, savedBuildVersionComparisonSharePayloadFromUnknown } from "./saved-build-version-share";

function check(findings?: Array<{ key: string; title: string; severity: string }>) {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    totalPriceWon: 1_000_000,
    priceComplete: true,
    analysisScore: 82,
    analysisScoreLabel: "상위권",
    analysisConfidence: "high",
    ...(findings ? { findings } : {}),
    engineVersion: "2.58.0",
    catalogSnapshotAt: "2026-09-07T00:00:00.000Z",
    checkedAt: "2026-09-07T00:00:00.000Z"
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION,
    kind: SAVED_BUILD_VERSION_SHARE_KIND,
    generatedAt: "2026-09-07T00:00:00.000Z",
    before: { id: "build-v1", label: "v1", versionNumber: 1, name: "원본", updatedAt: "2026-09-07T00:00:00.000Z", check: check([{ key: "rule-old", title: "기존 판정", severity: "warning" }]) },
    after: { id: "build-v2", label: "v2", versionNumber: 2, name: "수정", updatedAt: "2026-09-07T01:00:00.000Z", check: check([{ key: "rule-new", title: "신규 판정", severity: "unknown" }]) },
    summary: { direction: "changed", selectionChangedCategoryCount: 1, resolvedFindingCount: 1, newFindingCount: 1, changedFindingCount: 0 },
    transition: { direction: "changed", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: true, resolvedFindingCount: 1, newFindingCount: 1, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 },
    changes: [{ id: "category-cpu", label: "CPU", before: "기존 CPU", after: "수정 CPU" }],
    findingChanges: [{ key: "rule-old", change: "resolved", title: "기존 판정", severity: "warning" }, { key: "rule-new", change: "new", title: "신규 판정", severity: "unknown" }],
    dataBoundary: "저장 당시 snapshot 기준",
    text: "PC Supporter 저장 견적 버전 비교",
    ...overrides
  };
}

describe("saved build version share payload", () => {
  it("preserves compact finding summaries for public current recheck comparison", () => {
    const parsed = savedBuildVersionComparisonSharePayloadFromUnknown(payload());
    expect(parsed).toBeDefined();
    expect(parsed?.before.check?.findings).toEqual([{ key: "rule-old", title: "기존 판정", severity: "warning" }]);
    expect(parsed?.after.check?.findings).toEqual([{ key: "rule-new", title: "신규 판정", severity: "unknown" }]);
    expect(parsed?.findingChanges).toHaveLength(2);
  });

  it("rejects malformed compact finding summaries without weakening the public contract", () => {
    const malformedBefore = { ...(payload().before as Record<string, unknown>), check: check([{ key: "rule", title: "판정", severity: "warning" }, { key: "rule", title: "중복", severity: "warning" }]) };
    expect(savedBuildVersionComparisonSharePayloadFromUnknown(payload({ before: malformedBefore }))).toBeUndefined();
    expect(savedBuildVersionComparisonSharePayloadFromUnknown(payload({ kind: "wrong-kind" }))).toBeUndefined();
  });
});
