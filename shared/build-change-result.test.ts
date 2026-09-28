import { describe, expect, it } from "vitest";
import type { CompatibilityResult } from "./types";
import { buildChangeResultDecisionNoteFor, buildChangeResultExportFor, buildChangeResultTextFor } from "./build-change-result";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "incompatible",
    blockerCount: 1,
    warningCount: 1,
    unknownCount: 0,
    findings: [],
    metrics: {},
    analysis: {
      profile: "general",
      overallScore: 70,
      scoreLabel: "보완 권장",
      scoreBasis: "테스트",
      confidence: "limited",
      factors: [],
      strengths: [],
      focusAreas: [],
      bottlenecks: [],
      nextActions: []
    },
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    engineVersion: "test",
    catalogSnapshotAt: "2026-09-07T00:00:00.000Z",
    checkedAt: "2026-09-07T00:00:00.000Z",
    ...overrides
  };
}

describe("build change result export", () => {
  it("exports a compact applied-to-recheck comparison without full compatibility payloads", () => {
    const exported = buildChangeResultExportFor({
      title: "대체 부품 적용",
      summary: "부품을 적용하고 전체 규칙으로 다시 검사했습니다.",
      rows: [{ id: "gpu", label: "그래픽카드", before: "기존 GPU", after: "대체 GPU" }],
      beforeResult: result(),
      afterResult: result({ status: "compatible", blockerCount: 0, warningCount: 0, totalPriceWon: 1_080_000, analysis: { ...result().analysis, overallScore: 84, scoreLabel: "상위권", confidence: "high" } })
    }, "2026-09-07T01:00:00.000Z");

    expect(exported).toMatchObject({
      schemaVersion: 1,
      kind: "pc-supporter.build-change-result",
      direction: "improved",
      generatedAt: "2026-09-07T01:00:00.000Z",
      deltas: { blockerDelta: -1, warningDelta: -1, priceDeltaWon: 80_000 },
      changes: [{ label: "그래픽카드", before: "기존 GPU", after: "대체 GPU" }]
    });
    expect(exported.deltas).not.toHaveProperty("analysisScoreDelta");
    expect("findings" in exported.before).toBe(false);
    expect("metrics" in exported.after).toBe(false);
  });

  it("keeps the text export readable and states the evidence boundary", () => {
    const text = buildChangeResultTextFor({
      title: "대체 부품 적용",
      summary: "부품을 적용했습니다.",
      rows: [],
      beforeResult: result(),
      afterResult: result({ status: "compatible", blockerCount: 0, warningCount: 0 })
    }, "2026-09-07T01:00:00.000Z");

    expect(text).toContain("PC Supporter 부품 변경 결과");
    expect(text).toContain("변경 내용: 호환 상태 개선");
    expect(text).toContain("[구매 전 확인]");
    expect(text).toContain("게임 성능은 게임과 설정에 따라 달라집니다.");
  });

  it("creates a compact decision note for an explicit future save", () => {
    const note = buildChangeResultDecisionNoteFor({
      title: "대체 부품 적용",
      summary: "부품을 적용했습니다.",
      rows: [],
      beforeResult: result(),
      afterResult: result({ status: "compatible", blockerCount: 0, warningCount: 0 })
    });

    expect(note).toContain("적용 후 결과");
    expect(note).toContain("호환 가능");
    expect(note.length).toBeLessThanOrEqual(500);
  });
});
