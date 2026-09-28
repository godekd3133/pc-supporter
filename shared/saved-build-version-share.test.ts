import { describe, expect, it } from "vitest";
import { SAVED_BUILD_VERSION_SHARE_KIND, SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION, savedBuildVersionComparisonSharePayloadFor, savedBuildVersionComparisonSharePayloadFromUnknown } from "./saved-build-version-share";
import type { SavedBuildVersionComparisonExport } from "./saved-build-version-export";

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
    benchmarkSnapshot: { expectedScoreCount: 2, presentScoreCount: 2, parts: [{ category: "cpu", rows: [{ key: "cinebenchR23Multi", value: 18_000 }] }] },
    resourceBudget: { state: "warning", powerState: "good", coolingState: "warning", powerHeadroomW: 120, coolerHeadroomW: -10 },
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
    before: { id: "build-v1", label: "v1", versionNumber: 1, name: "원본", updatedAt: "2026-09-07T00:00:00.000Z", check: check([{ key: "rule-old", title: "기존 결과", severity: "warning" }]) },
    after: { id: "build-v2", label: "v2", versionNumber: 2, name: "수정", updatedAt: "2026-09-07T01:00:00.000Z", check: check([{ key: "rule-new", title: "신규 결과", severity: "unknown" }]) },
    summary: { direction: "changed", selectionChangedCategoryCount: 1, analysisScoreDelta: -8, resolvedFindingCount: 1, newFindingCount: 1, changedFindingCount: 0 },
    transition: { direction: "changed", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceDeltaWon: 20000, analysisScoreDelta: -8, priceCompletenessChanged: false, resourceBudgetChanged: true, benchmarkChanged: true, benchmarkNeedsReview: true, benchmarkImpact: { changedScoreCount: 1, rows: [{ value: 21000 }], provenance: "private" }, engineChanged: false, catalogChanged: true, resolvedFindingCount: 1, newFindingCount: 1, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 },
    changes: [{ id: "category-cpu", label: "CPU", before: "기존 CPU", after: "수정 CPU" }],
    findingChanges: [{ key: "rule-old", change: "resolved", title: "기존 결과", severity: "warning" }, { key: "rule-new", change: "new", title: "신규 결과", severity: "unknown" }],
    dataBoundary: "저장 당시 저장본 기준",
    text: [
      "PC Supporter 저장 견적 버전 비교",
      "호환 상태: 호환 불가 1 → 확인 필요 1",
      "가격 변화: +20,000원",
      "부품 정보 기준일: 2026-09-07T00:00:00.000Z",
      "성능 분석: 82점 → 74점",
      "벤치마크 자료: Cinebench R23 Multi 18000 · 3DMark Time Spy 21000",
      "추천 신뢰 점수 92점",
      "평균 FPS 144 FPS 측정"
    ].join("\n"),
    ...overrides
  };
}

describe("saved build version share payload", () => {
  it("preserves compact finding summaries for public current recheck comparison", () => {
    const parsed = savedBuildVersionComparisonSharePayloadFromUnknown(payload());
    expect(parsed).toBeDefined();
    expect(parsed?.before.check?.findings).toEqual([{ key: "rule-old", title: "기존 결과", severity: "warning" }]);
    expect(parsed?.after.check?.findings).toEqual([{ key: "rule-new", title: "신규 결과", severity: "unknown" }]);
    expect(parsed?.findingChanges).toHaveLength(2);
    expect(parsed?.before.check).toMatchObject({ status: "compatible", blockerCount: 0, totalPriceWon: 1_000_000, resourceBudget: { powerHeadroomW: 120, coolerHeadroomW: -10 }, engineVersion: "2.58.0", catalogSnapshotAt: "2026-09-07T00:00:00.000Z" });
    expect(parsed?.summary).not.toHaveProperty("analysisScoreDelta");
    expect(parsed?.transition).not.toHaveProperty("analysisScoreDelta");
    expect(parsed?.transition).not.toHaveProperty("benchmarkChanged");
    expect(parsed?.transition).not.toHaveProperty("benchmarkNeedsReview");
    expect(parsed?.text).toContain("호환 상태: 호환 불가 1 → 확인 필요 1");
    expect(parsed?.text).toContain("가격 변화: +20,000원");
    expect(parsed?.text).toContain("부품 정보 기준일: 2026-09-07T00:00:00.000Z");
    const publicJson = JSON.stringify(parsed);
    expect(publicJson).not.toContain("analysisScore");
    expect(publicJson).not.toContain("analysisConfidence");
    expect(publicJson).not.toContain("benchmarkSnapshot");
    expect(publicJson).not.toContain("benchmarkImpact");
    expect(publicJson).not.toContain("Cinebench");
    expect(publicJson).not.toContain("21000");
    expect(publicJson).not.toContain("144 FPS");
    expect(publicJson).not.toContain("추천 신뢰 점수");
  });

  it("builds POST helper output without score or benchmark fields while preserving practical comparisons", () => {
    const exported = {
      schemaVersion: 1,
      kind: "pc-supporter.saved-build-version-comparison",
      generatedAt: "2026-09-07T02:00:00.000Z",
      before: { id: "build-v1", label: "v1", versionNumber: 1, name: "원본", updatedAt: "2026-09-07T00:00:00.000Z", check: check([{ key: "rule-old", title: "기존 결과", severity: "warning" }]) },
      after: { id: "build-v2", label: "v2", versionNumber: 2, name: "수정", updatedAt: "2026-09-07T01:00:00.000Z", check: check([{ key: "rule-new", title: "신규 결과", severity: "unknown" }]) },
      summary: { direction: "changed", selectionChangedCategoryCount: 1, priceDeltaWon: 20_000, analysisScoreDelta: -8, resolvedFindingCount: 1, newFindingCount: 1, changedFindingCount: 0 },
      transition: { direction: "changed", statusChanged: false, blockerDelta: 0, warningDelta: 1, unknownDelta: 0, priceDeltaWon: 20_000, analysisScoreDelta: -8, analysisChanged: true, priceCompletenessChanged: false, resourceBudgetChanged: true, resourceRiskIncreased: false, resourceRiskDecreased: false, powerHeadroomDeltaW: -10, benchmarkChanged: true, benchmarkNeedsReview: true, benchmarkImpact: { changedScoreCount: 1, rows: [{ value: 21_000 }] }, engineChanged: false, catalogChanged: true, resolvedFindingCount: 1, newFindingCount: 1, severityChangedFindingCount: 0, detailsChangedFindingCount: 0, findingDiffAvailable: true, unchangedFindingCount: 0, hasChanges: true },
      changes: [{ id: "category-cpu", label: "CPU", before: "기존 CPU", after: "수정 CPU" }],
      findingChanges: [{ key: "rule-old", change: "resolved", before: { key: "rule-old", title: "기존 결과", severity: "warning" }, after: undefined }],
      dataBoundary: "저장 당시 결과 비교",
      beforePrivateCheck: { analysisScore: 82, benchmarkSnapshot: { rows: [{ value: 18_000 }] } }
    } as unknown as SavedBuildVersionComparisonExport;
    const shared = savedBuildVersionComparisonSharePayloadFor(exported, "호환 상태: 확인 필요\n성능 분석: 82점\nCinebench R23 18000\n평균 FPS 144 FPS 측정\n가격 변화: +20,000원");
    const publicJson = JSON.stringify(shared);

    expect(shared.before.check).toMatchObject({ status: "compatible", totalPriceWon: 1_000_000, priceComplete: true, resourceBudget: { powerHeadroomW: 120, coolerHeadroomW: -10 } });
    expect(shared.summary).toMatchObject({ selectionChangedCategoryCount: 1, priceDeltaWon: 20_000, resolvedFindingCount: 1 });
    expect(shared.transition).toMatchObject({ priceDeltaWon: 20_000, resourceBudgetChanged: true, powerHeadroomDeltaW: -10 });
    expect(shared.changes).toEqual([{ id: "category-cpu", label: "CPU", before: "기존 CPU", after: "수정 CPU" }]);
    expect(shared.text).toContain("호환 상태: 확인 필요");
    expect(shared.text).toContain("가격 변화: +20,000원");
    expect(shared.text).not.toContain("성능 분석");
    expect(shared.text).not.toContain("Cinebench");
    expect(shared.text).not.toContain("FPS");
    expect(publicJson).not.toContain("analysisScore");
    expect(publicJson).not.toContain("analysisConfidence");
    expect(publicJson).not.toContain("analysisScoreDelta");
    expect(publicJson).not.toContain("benchmark");
    expect(publicJson).not.toContain("18000");
    expect(publicJson).not.toContain("21,000");
  });

  it("normalizes fully private legacy text instead of rejecting an otherwise valid payload", () => {
    const parsed = savedBuildVersionComparisonSharePayloadFromUnknown(payload({ text: "성능 분석 82점\nCinebench R23 18000점\n평균 FPS 144 FPS 측정" }));

    expect(parsed).toBeDefined();
    expect(parsed?.text).toBe("PC Supporter 저장 견적 버전 비교");
    expect(JSON.stringify(parsed)).not.toContain("analysisScore");
    expect(JSON.stringify(parsed)).not.toContain("Cinebench");
    expect(JSON.stringify(parsed)).not.toContain("144 FPS");
  });

  it("rejects malformed compact finding summaries without weakening the public contract", () => {
    const malformedBefore = { ...(payload().before as Record<string, unknown>), check: check([{ key: "rule", title: "결과", severity: "warning" }, { key: "rule", title: "중복", severity: "warning" }]) };
    expect(savedBuildVersionComparisonSharePayloadFromUnknown(payload({ before: malformedBefore }))).toBeUndefined();
    expect(savedBuildVersionComparisonSharePayloadFromUnknown(payload({ kind: "wrong-kind" }))).toBeUndefined();
  });
});
