import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE_GENERATION_OPTION_DEFAULTS, engineGenerationLadderMultipliersFor, engineGenerationVariantPrioritiesFor, invalidateEngineGenerationOptionsCache, loadEngineGenerationOptions, normalizeEngineGenerationOptions, saveEngineGenerationOptions } from "./quotation-engine";
import { budgetLadderScenariosFor } from "../../shared/budget-ladder";
import type { BuildGenerationRequest } from "../../shared/types";

let tempDir: string;
let previousPath: string | undefined;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pc-supporter-engine-options-"));
  previousPath = process.env.ENGINE_GENERATION_OPTIONS_PATH;
  process.env.ENGINE_GENERATION_OPTIONS_PATH = join(tempDir, "engine-generation-options.json");
  invalidateEngineGenerationOptionsCache();
});

afterAll(() => {
  if (previousPath === undefined) delete process.env.ENGINE_GENERATION_OPTIONS_PATH;
  else process.env.ENGINE_GENERATION_OPTIONS_PATH = previousPath;
  invalidateEngineGenerationOptionsCache();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("engine generation options", () => {
  it("파일이 없으면 기본 옵션을 돌려준다", () => {
    expect(loadEngineGenerationOptions()).toEqual(ENGINE_GENERATION_OPTION_DEFAULTS);
  });

  it("저장 후 다시 읽으면 같은 옵션이 나오고 조회 헬퍼에 반영된다", async () => {
    await saveEngineGenerationOptions({
      variantPriorities: ["performance", "reliability"],
      budgetLadderDownMultiplier: 0.7,
      budgetLadderUpMultiplier: 1.4,
      generationDepth: 1
    });
    expect(engineGenerationVariantPrioritiesFor()).toEqual(["performance", "reliability"]);
    expect(engineGenerationLadderMultipliersFor()).toEqual({ down: 0.7, up: 1.4 });
  });

  it("깨진 파일은 기본 옵션으로 fail-open한다", () => {
    invalidateEngineGenerationOptionsCache();
    writeFileSync(process.env.ENGINE_GENERATION_OPTIONS_PATH!, "{broken", "utf8");
    expect(loadEngineGenerationOptions()).toEqual(ENGINE_GENERATION_OPTION_DEFAULTS);
  });

  it("모르는 우선순위·범위 밖 배율·빈 우선순위 세트를 거부한다", () => {
    expect(normalizeEngineGenerationOptions({ variantPriorities: ["extreme"] }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ variantPriorities: [] }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ budgetLadderDownMultiplier: 3 }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ budgetLadderUpMultiplier: 0.9 }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions("text").errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ generationDepth: -1 }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ generationDepth: 1.5 }).errors.length).toBeGreaterThan(0);
    expect(normalizeEngineGenerationOptions({ generationDepth: 2 }).options.generationDepth).toBe(2);
    expect(normalizeEngineGenerationOptions({ generationDepth: 0 }).options.generationDepth).toBe(0);
  });

  it("중복 우선순위를 제거하고 알려진 우선순위를 그대로 유지한다", () => {
    const { options, errors } = normalizeEngineGenerationOptions({ variantPriorities: ["budget", "budget", "balanced"] });
    expect(errors).toEqual([]);
    expect(options.variantPriorities).toEqual(["budget", "balanced"]);
  });
});

describe("budget ladder with engine options", () => {
  const request: BuildGenerationRequest = {
    profile: "office",
    priority: "balanced",
    budgetWon: 1_000_000,
    includeGpu: false,
    memoryCapacityGb: 16,
    storageCapacityGb: 500,
    hddCount: 0,
    listingPolicy: "retail_only"
  };

  it("관리자 배율이 사다리 예산과 설명에 반영된다", () => {
    const scenarios = budgetLadderScenariosFor(request, { down: 0.7, up: 1.4 });
    expect(scenarios.map((scenario) => scenario.id)).toEqual(["economy", "target", "headroom"]);
    expect(scenarios[0].budgetWon).toBe(700_000);
    expect(scenarios[0].description).toContain("70%");
    expect(scenarios[1].budgetWon).toBe(1_000_000);
    expect(scenarios[2].budgetWon).toBe(1_400_000);
    expect(scenarios[2].description).toContain("140%");
  });

  it("배율 없이 호출하면 기본 0.8/1.2를 유지한다", () => {
    const scenarios = budgetLadderScenariosFor(request);
    expect(scenarios[0].budgetWon).toBe(800_000);
    expect(scenarios[2].budgetWon).toBe(1_200_000);
    expect(scenarios[0].description).toContain("80%");
  });
});
