import { describe, expect, it } from "vitest";
import type { BuildGenerationDiagnostic, BuildGenerationRequest, BuildGenerationResult } from "./types";
import { budgetLadderBaseRequestFor, budgetLadderChangeFor, budgetLadderCsvFor, budgetLadderJsonFor, budgetLadderScenariosFor, budgetLadderTextFor } from "./budget-ladder";
import type { BudgetLadderOutcome } from "./budget-ladder";

const request: BuildGenerationRequest = {
  profile: "gaming",
  budgetWon: 1_500_000,
  includeGpu: true,
  priority: "balanced",
  gamingResolution: "1440p",
  gamingRefreshRate: 240,
  memoryCapacityGb: 32,
  storageCapacityGb: 1000,
  hddCapacityGb: 4000,
  hddCount: 0,
  listingPolicy: "retail_only"
};

function draft(overrides: Partial<BuildGenerationResult> = {}): BuildGenerationResult {
  return {
    selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true },
    profile: "gaming",
    priority: "balanced",
    gamingResolution: "1440p",
    gamingRefreshRate: 240,
    memoryCapacityGb: 32,
    analysis: { profile: "gaming", overallScore: 60, scoreLabel: "균형형", scoreBasis: "test", confidence: "limited", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
    budgetWon: 1_000_000,
    includeNonRetail: false,
    listingPolicy: "retail_only",
    storageCapacityGb: 1000,
    hddCount: 0,
    totalPriceWon: 900_000,
    budgetDeltaWon: -100_000,
    withinBudget: true,
    priceComplete: true,
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    lines: [
      { category: "cpu", partId: "cpu-old", name: "이전 CPU", quantity: 1, priceWon: 200_000 },
      { category: "gpu", partId: "gpu-same", name: "같은 GPU", quantity: 1, priceWon: 400_000 }
    ],
    rationale: [],
    warnings: [],
    ...overrides
  };
}

describe("budget ladder scenarios", () => {
  it("creates deterministic economy, target, and headroom budgets while preserving request constraints", () => {
    const scenarios = budgetLadderScenariosFor(request);

    expect(scenarios.map((scenario) => [scenario.id, scenario.budgetWon])).toEqual([
      ["economy", 1_200_000],
      ["target", 1_500_000],
      ["headroom", 1_800_000]
    ]);
    expect(scenarios.every((scenario) => scenario.request.gamingRefreshRate === 240)).toBe(true);
    expect(scenarios.map((scenario) => scenario.request.budgetWon)).toEqual(scenarios.map((scenario) => scenario.budgetWon));
  });

  it("keeps very small budgets valid and rounds only the derived bands", () => {
    const scenarios = budgetLadderScenariosFor({ ...request, budgetWon: 1 });

    expect(scenarios.every((scenario) => scenario.budgetWon >= 1)).toBe(true);
    expect(scenarios[1].budgetWon).toBe(1);
    expect(scenarios.every((scenario) => scenario.request.budgetWon === scenario.budgetWon)).toBe(true);
  });

  it("uses the target request as the base context instead of the economy band", () => {
    const scenarios = budgetLadderScenariosFor(request);

    expect(budgetLadderBaseRequestFor(scenarios)?.budgetWon).toBe(1_500_000);
  });

  it("explains adjacent budget changes without treating price growth as performance proof", () => {
    const change = budgetLadderChangeFor(
      { id: "economy", label: "절약형", budgetWon: 800_000, draft: draft() },
      { id: "target", label: "목표 예산", budgetWon: 1_000_000, draft: draft({ totalPriceWon: 980_000, analysis: { profile: "gaming", overallScore: 76, scoreLabel: "균형형", scoreBasis: "test", confidence: "limited", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, lines: [{ category: "cpu", partId: "cpu-new", name: "새 CPU", quantity: 1, priceWon: 280_000 }, { category: "gpu", partId: "gpu-same", name: "같은 GPU", quantity: 1, priceWon: 400_000 }] }) }
    );

    expect(change).toMatchObject({ fromLabel: "절약형", toLabel: "목표 예산", budgetDeltaWon: 200_000, totalPriceDeltaWon: 80_000, blockerDelta: 0, analysisScoreDelta: 16, sameConfiguration: false });
    expect(change?.changedLines).toEqual([{ category: "cpu", label: "CPU", before: "이전 CPU", after: "새 CPU" }]);
  });

  it("marks identical adjacent configurations even when the observed price changes", () => {
    const change = budgetLadderChangeFor(
      { id: "target", label: "목표 예산", budgetWon: 1_000_000, draft: draft() },
      { id: "headroom", label: "여유형", budgetWon: 1_200_000, draft: draft({ totalPriceWon: 950_000 }) }
    );

    expect(change?.sameConfiguration).toBe(true);
    expect(change?.changedLines).toEqual([]);
    expect(change?.totalPriceDeltaWon).toBe(50_000);
  });

  it("does not invent a delta when either budget scenario failed", () => {
    expect(budgetLadderChangeFor(
      { id: "economy", label: "절약형", budgetWon: 800_000 },
      { id: "target", label: "목표 예산", budgetWon: 1_000_000, draft: draft() }
    )).toBeUndefined();
  });

  it("exports successful and failed scenarios with the same observed evidence as the screen", () => {
    const diagnostic: BuildGenerationDiagnostic = {
      id: "gpu-pool",
      title: "GPU 후보 부족",
      summary: "조건을 만족하는 후보가 없습니다.",
      facts: [{ label: "후보 수", value: "0개" }],
      recommendation: "예산을 상향해 주세요."
    };
    const outcomes: BudgetLadderOutcome[] = [
      { id: "economy", label: "절약형", description: "입력 예산의 약 80%로 구성", budgetWon: 800_000, draft: draft() },
      { id: "target", label: "목표 예산", description: "입력한 목표 예산 그대로", budgetWon: 1_000_000, draft: draft({ totalPriceWon: 980_000, analysis: { profile: "gaming", overallScore: 76, scoreLabel: "균형형", scoreBasis: "test", confidence: "limited", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, lines: [{ category: "cpu", partId: "cpu-new", name: "새 CPU", quantity: 1, priceWon: 280_000 }, { category: "gpu", partId: "gpu-same", name: "같은 GPU", quantity: 1, priceWon: 400_000 }] }) },
      { id: "headroom", label: "여유형", description: "입력 예산의 약 120%로 구성", budgetWon: 1_200_000, error: "조건을 만족하는 후보가 없습니다.", diagnostics: [diagnostic] }
    ];

    const text = budgetLadderTextFor(outcomes);
    expect(text).toContain("[목표 예산] 입력한 목표 예산 그대로");
    expect(text).toContain("예상 합계: 980,000원");
    expect(text).toContain("변경: CPU · 이전 CPU → 새 CPU");
    expect(text).toContain("실패 근거: GPU 후보 부족: 조건을 만족하는 후보가 없습니다. · 후보 수 0개 · 권장 예산을 상향해 주세요.");

    const csv = budgetLadderCsvFor(outcomes);
    expect(csv.startsWith("\uFEFF구간 ID,구간,설명")).toBe(true);
    expect(csv).toContain("economy,절약형,입력 예산의 약 80%로 구성,800000,호환 가능");
    expect(csv).toContain("headroom,여유형,입력 예산의 약 120%로 구성,1200000,생성 실패");
    expect(csv).toContain("조건을 만족하는 후보가 없습니다.");

    const json = JSON.parse(budgetLadderJsonFor(outcomes)) as { type: string; version: number; exportedAt: string; items: Array<Record<string, unknown>>; changes: Array<Record<string, unknown>> };
    expect(json.type).toBe("pc-supporter-budget-ladder");
    expect(json.version).toBe(1);
    expect(Number.isNaN(Date.parse(json.exportedAt))).toBe(false);
    expect(json.items[0]).toMatchObject({ id: "economy", status: "호환 가능", totalPriceWon: 900_000 });
    expect(json.items[0].lines).toEqual(expect.arrayContaining([expect.objectContaining({ category: "cpu", text: "이전 CPU" })]));
    expect(json.items[0].selection).toMatchObject({ memory: [], ssd: [], hdd: [], useIntegratedGraphics: true });
    expect(json.items[2]).toMatchObject({ id: "headroom", status: "생성 실패", error: "조건을 만족하는 후보가 없습니다.", diagnostics: [diagnostic] });
    expect(json.changes).toHaveLength(1);
    expect(json.changes[0]).toMatchObject({ fromId: "economy", toId: "target", totalPriceDeltaWon: 80_000, analysisScoreDelta: 16 });
  });

  it("quotes CSV descriptions and errors without losing newlines or quotes", () => {
    const csv = budgetLadderCsvFor([{ id: "economy", label: "절약형", description: "설명, \"특수\"\n줄바꿈", budgetWon: 800_000, error: "오류, \"확인\"" }]);

    expect(csv).toContain('"설명, ""특수""\n줄바꿈"');
    expect(csv).toContain('"오류, ""확인"""');
  });
});
