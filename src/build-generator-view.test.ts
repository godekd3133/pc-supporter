import { describe, expect, it } from "vitest";
import { generatedDraftSummaryFor, generatedGamingGpuChoiceText, generatedVariantGamingConditionText, generatorMemoryParamFor, generatorVariantsImportPreviewFor, generatorVariantsJsonFor, phase1BriefInterpretationFor, savedPresetConditionTagsFor } from "./BuildGeneratorView";
import type { BuildGenerationResult } from "../shared/types";
import type { SavedGeneratorPreset } from "../shared/generator-preset";

const draftSelection: BuildGenerationResult["selection"] = {
  cpu: { partId: "cpu-1", quantity: 1 },
  motherboard: { partId: "mb-1", quantity: 1 },
  memory: [{ partId: "mem-1", quantity: 2 }],
  ssd: [{ partId: "ssd-1", quantity: 1 }],
  hdd: [],
  case: { partId: "case-1", quantity: 1 },
  psu: { partId: "psu-1", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: true
};

function importedDraft(overrides: Record<string, unknown> = {}): BuildGenerationResult {
  return {
    status: "compatible",
    profile: "general",
    priority: "balanced",
    listingPolicy: "retail_only",
    totalPriceWon: 1_000_000,
    budgetWon: 1_500_000,
    budgetDeltaWon: -500_000,
    withinBudget: true,
    priceComplete: true,
    includeNonRetail: false,
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    memoryCapacityGb: 32,
    storageCapacityGb: 1000,
    hddCount: 0,
    gamingResolution: "1440p",
    gamingRefreshRate: 144,
    selection: draftSelection,
    lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: 300_000 }],
    warnings: [],
    rationale: [],
    ...overrides
  } as BuildGenerationResult;
}

function importPayload(draftOverrides: Record<string, unknown> | null = {}, extra: Record<string, unknown> = {}) {
  return {
    type: "pc-supporter-generator-variants",
    version: 1,
    exportedAt: "2026-09-17T00:00:00.000Z",
    items: [{
      priority: "balanced",
      label: "균형형",
      status: "호환 가능",
      ...(draftOverrides === null ? {} : { draft: importedDraft(draftOverrides) })
    }],
    ...extra
  };
}

describe("generatedDraftSummaryFor", () => {
  it("describes the gaming display target as a build goal, not a measured result", () => {
    const draft = importedDraft({ profile: "gaming", priority: "performance", budgetWon: 2_000_000 });
    expect(generatedDraftSummaryFor(draft)).toBe("예산에 맞는 게임용 PC예요. 예산 200만 원 안에서 그래픽카드 성능을 먼저 고려했어요.");
  });

  it("keeps an exact budget when it cannot be written in whole ten-thousands", () => {
    const draft = importedDraft({ profile: "office", budgetWon: 2_000_860, withinBudget: false });
    expect(generatedDraftSummaryFor(draft)).toBe("사무용 견적이에요. 예산은 2,000,860원으로 설정했어요.");
  });
});

describe("gaming brief", () => {
  it("preserves game target settings for the form request", () => {
    const interpretation = phase1BriefInterpretationFor("QHD 게임용 PC 220만원 144Hz", "gaming");
    expect(interpretation.config).toMatchObject({ profile: "gaming", budgetWon: 2_200_000 });
    expect(interpretation.config.gamingResolution).toBe("1440p");
    expect(interpretation.config.gamingRefreshRate).toBe(144);
    expect(interpretation.matches.some((match) => match.field === "gamingRefreshRate")).toBe(true);
    expect(interpretation.warnings.join(" ")).not.toContain("다음 단계");
    expect(interpretation.coverage.total).toBeGreaterThan(0);
  });

  it("preserves the fields of a work request", () => {
    const interpretation = phase1BriefInterpretationFor("개발용 250만원 RAM 64GB SSD 2TB", "gaming");
    expect(interpretation.config).toMatchObject({ profile: "development", memoryCapacityGb: 64, storageCapacityGb: 2000 });
  });
});

describe("generatedVariantGamingConditionText", () => {
  it("labels the requested display refresh rate in hertz without claiming measured FPS", () => {
    const text = generatedVariantGamingConditionText(importedDraft({ profile: "gaming" }));
    expect(text).toContain("144Hz");
    expect(text).not.toContain("FPS");
  });

  it("shows the selected upscaling setting beside a target FPS", () => {
    const text = generatedVariantGamingConditionText(importedDraft({ profile: "gaming", gamingMode: "target_fps", gamingTargetFps: 120, gamingGameIds: ["cyberpunk"], gamingGraphicsPreset: "high", gamingUpscaling: "quality" }));
    expect(text).toContain("목표 120 FPS");
    expect(text).toContain("업스케일링·품질");
  });

  it("shows integrated graphics without calling it an NVIDIA graphics card", () => {
    const draft = importedDraft({ profile: "gaming", gamingMode: "budget", gpuVendorPreference: "nvidia" });
    expect(generatedVariantGamingConditionText(draft)).toContain("내장 그래픽");
    expect(generatedVariantGamingConditionText(draft)).not.toContain("NVIDIA");
    expect(generatedGamingGpuChoiceText(draft)).toBe("CPU 내장 그래픽을 사용해요.");
  });

  it("does not infer the vendor when older drafts have no manufacturer preference", () => {
    const draft = importedDraft({ profile: "gaming", gamingMode: "budget", selection: { ...draftSelection, gpu: { partId: "gpu-1", quantity: 1 }, useIntegratedGraphics: false } });
    expect(generatedVariantGamingConditionText(draft)).toContain("외장 그래픽카드");
    expect(generatedGamingGpuChoiceText(draft)).not.toContain("NVIDIA");
  });

  it("does not assume integrated graphics merely because the GPU slot is empty", () => {
    const draft = importedDraft({ profile: "gaming", gamingMode: "budget", selection: { ...draftSelection, useIntegratedGraphics: false } });
    expect(generatedGamingGpuChoiceText(draft)).toBe("외장 그래픽카드가 포함되지 않았어요.");
    expect(generatedVariantGamingConditionText(draft)).not.toContain("내장 그래픽");
  });
});

describe("generator RAM URL persistence", () => {
  it.each(["32", "64", "128"])("includes gaming RAM %sGB instead of restoring it as the 16GB default", (capacityGb) => {
    const url = new URLSearchParams();
    const memory = generatorMemoryParamFor("gaming", capacityGb);
    if (memory !== undefined) url.set("ram", memory);
    expect(url.get("ram") ?? "16").toBe(capacityGb);
  });

  it("omits only the matching profile default", () => {
    expect(generatorMemoryParamFor("gaming", "16")).toBeUndefined();
    expect(generatorMemoryParamFor("office", "32")).toBeUndefined();
    expect(generatorMemoryParamFor("office", "16")).toBe("16");
  });
});

describe("savedPresetConditionTagsFor", () => {
  function savedPresetWith(patch: Partial<SavedGeneratorPreset>): SavedGeneratorPreset {
    return {
      id: "preset-1",
      name: "테스트 프리셋",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      profile: "general",
      priority: "balanced",
      gamingResolution: "1440p",
      gamingRefreshRate: 144,
      memoryCapacityGb: 32,
      budgetWon: 1_500_000,
      includeGpu: true,
      storageCapacityGb: 1000,
      hddCount: 0,
      hddCapacityGb: 4000,
      listingPolicy: "retail_only",
      ...patch
    };
  }

  it("summarizes gaming target, graphics options and hardware conditions", () => {
    const tags = savedPresetConditionTagsFor(savedPresetWith({
      profile: "gaming",
      priority: "performance",
      gamingResolution: "1440p",
      gamingRefreshRate: 144,
      gamingGameIds: ["league", "cyberpunk"],
      gamingGraphicsPreset: "high",
      gamingRayTracing: true,
      gamingUpscaling: "quality",
      memoryCapacityGb: 32,
      storageCapacityGb: 2000,
      hddCount: 1,
      hddCapacityGb: 4000,
      listingPolicy: "include_bulk"
    }));
    expect(tags).toEqual(["QHD", "144Hz", "높음", "업스케일링·품질", "레이 트레이싱", "게임 2개", "외장 GPU", "RAM 32GB", "SSD 2TB", "HDD 4TB×1", "벌크 포함"]);
  });

  it("keeps a compact summary for non-gaming presets", () => {
    const tags = savedPresetConditionTagsFor(savedPresetWith({ profile: "office", includeGpu: false, memoryCapacityGb: 16, storageCapacityGb: 500 }));
    expect(tags).toEqual(["내장 그래픽", "RAM 16GB", "SSD 500GB"]);
  });
});

describe("generatorVariantsJsonFor", () => {
  it("omits fixed-anchor analysis scores and analysis details from customer exports", () => {
    const draft = importedDraft({
      analysis: {
        profile: "general",
        overallScore: 87,
        scoreLabel: "상위권",
        scoreBasis: "고정 기준 점수",
        confidence: "high",
        factors: [],
        strengths: [],
        focusAreas: [],
        bottlenecks: [],
        nextActions: []
      }
    });
    const exported = JSON.parse(generatorVariantsJsonFor([{ priority: "balanced", draft }])) as { items: Array<Record<string, unknown>> };

    expect(exported.items[0]).not.toHaveProperty("analysisScore");
    expect(exported.items[0].draft).not.toHaveProperty("analysis");
    expect(exported.items[0].totalPriceWon).toBe(draft.totalPriceWon);
  });
});

describe("generatorVariantsImportPreviewFor", () => {
  it("accepts a well-formed export and enables apply", () => {
    const parsed = generatorVariantsImportPreviewFor(importPayload());
    expect(parsed.error).toBeUndefined();
    expect(parsed.items).toHaveLength(1);
    expect(parsed.variants).toHaveLength(1);
    expect(parsed.variants?.[0].priority).toBe("balanced");
  });

  it("shows a preview but disables apply when drafts are missing or unusable", () => {
    expect(generatorVariantsImportPreviewFor(importPayload(null)).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ selection: undefined })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ selection: {} })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ selection: { memory: "not-an-array", ssd: [], hdd: [] } })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ selection: { memory: [], ssd: [], hdd: [], cpu: { partId: 7, quantity: 1 } } })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ profile: "toString" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ listingPolicy: "everything" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ gamingResolution: "8k" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload(null)).error).toBeUndefined();
  });

  it("blocks unsafe line values and a draft priority that contradicts its wrapper", () => {
    expect(generatorVariantsImportPreviewFor(importPayload({ lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: -1, priceWon: 300_000 }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: -1 }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: 300_000 }, { category: "cpu", partId: "cpu-2", name: "중복 CPU", quantity: 1, priceWon: 100_000 }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ priority: "performance" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ warnings: [7] })).variants).toBeUndefined();
  });

  it("rejects selections with malformed accessory targets, m2 slots, or hub controller ids", () => {
    const withSelection = (selection: Record<string, unknown>) => importPayload({ selection: { ...draftSelection, ...selection } });
    expect(generatorVariantsImportPreviewFor(withSelection({ accessories: [{ accessoryId: "acc-1", quantity: 1, targetPartId: {} }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ accessories: [{ accessoryId: "acc-1", quantity: 1, targetAccessoryId: 7 }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ accessories: [{ accessoryId: "acc-1", quantity: 1, targetPartId: "  " }] })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ m2SlotSelection: { NVME_1: "ssd-1" } })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ m2SlotSelection: { M2_1: { partId: "ssd-1" } } })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ m2SlotSelection: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`M2_${i + 1}`, "ssd-1"])) })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(withSelection({ rgbControllerAccessoryId: 42 })).variants).toBeUndefined();
  });

  it("accepts selections with valid accessory targets and m2 slot assignments", () => {
    const parsed = generatorVariantsImportPreviewFor(importPayload({
      selection: {
        ...draftSelection,
        accessories: [{ accessoryId: "acc-1", quantity: 1, targetPartId: "ssd-1", targetAccessoryId: "hub-1" }],
        m2SlotSelection: { M2_1: "ssd-1", M2_2: "ssd-2" },
        rgbControllerAccessoryId: "hub-1"
      }
    }));
    expect(parsed.error).toBeUndefined();
    expect(parsed.variants).toHaveLength(1);
  });

  it("rejects malformed envelopes", () => {
    expect(generatorVariantsImportPreviewFor(null).error).toBeTruthy();
    expect(generatorVariantsImportPreviewFor("text").error).toBeTruthy();
    expect(generatorVariantsImportPreviewFor({ type: "other", version: 1, items: [] }).error).toBeTruthy();
    expect(generatorVariantsImportPreviewFor(importPayload({}, { items: [] })).error).toBeTruthy();
    const fourItems = importPayload();
    expect(generatorVariantsImportPreviewFor({ ...fourItems, items: [...fourItems.items, ...fourItems.items, ...fourItems.items, { ...fourItems.items[0], priority: "reliability" }] }).error).toBeTruthy();
    expect(generatorVariantsImportPreviewFor({ ...fourItems, items: [...fourItems.items, { ...fourItems.items[0] }] }).error).toBeTruthy();
  });
});


describe("phase-two generated conditions", () => {
  it("does not hide explicit target FPS behind the restricted-catalog flag", () => {
    const draft = importedDraft({ profile: "gaming", gamingTestbedPhase1: true, gamingMode: "target_fps", gamingTargetFps: 120, gamingRefreshRate: 144, gamingGameIds: ["pubg"], gpuVendorPreference: "amd" });
    expect(generatedVariantGamingConditionText(draft)).toContain("목표 120 FPS");
    expect(generatedDraftSummaryFor(draft)).toContain("목표 120 FPS");
    expect(generatedVariantGamingConditionText(draft)).not.toContain("GPU 성능 우선");
  });

  it("rejects invalid target or vendor metadata before imported drafts can be applied", () => {
    expect(generatorVariantsImportPreviewFor(importPayload({ gamingTargetFps: 501 })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ gpuVendorPreference: "intel" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ gamingMode: "fiction" })).variants).toBeUndefined();
    expect(generatorVariantsImportPreviewFor(importPayload({ profile: "gaming", gamingMode: "target_fps", gamingTargetFps: 120, gamingGameIds: ["cyberpunk"], gpuVendorPreference: "amd" })).variants).toHaveLength(1);
  });

  it("blocks applying FPS drafts whose requested game conditions are incomplete or invalid", () => {
    const target = { profile: "gaming", gamingMode: "target_fps", gamingTargetFps: 120, gamingGameIds: ["cyberpunk"], gamingGraphicsPreset: "high", gamingRayTracing: false, gamingUpscaling: "native" };
    for (const patch of [
      { profile: "office" }, { gamingTargetFps: undefined }, { gamingGameIds: undefined }, { gamingGameIds: [] },
      { gamingGameIds: ["cyberpunk", "cyberpunk"] }, { gamingGameIds: ["unknown-game"] },
      { gamingGameIds: Array.from({ length: 6 }, (_, i) => `game-${i}`) }, { gamingGameIds: "cyberpunk" },
      { gamingGraphicsPreset: "made-up" }, { gamingRayTracing: "yes" }, { gamingUpscaling: "made-up" }
    ]) {
      expect(generatorVariantsImportPreviewFor(importPayload({ ...target, ...patch })).variants).toBeUndefined();
    }
  });
});


describe("imported FPS evidence", () => {
  it("discards persisted FPS claims before applying an imported draft", () => {
    const imported = generatorVariantsImportPreviewFor(importPayload({ gamingTargetAssessment: { status: "verified", targetMet: true, measurements: "broken" }, gamingPerformanceAssessment: { status: "verified" } }));
    expect(imported.variants).toHaveLength(1);
    expect(imported.variants?.[0].draft?.gamingTargetAssessment).toBeUndefined();
    expect(imported.variants?.[0].draft?.gamingPerformanceAssessment).toBeUndefined();
  });
});
