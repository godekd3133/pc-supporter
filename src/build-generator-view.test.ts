import { describe, expect, it } from "vitest";
import { generatedDraftSummaryFor, generatorVariantsImportPreviewFor } from "./BuildGeneratorView";
import type { BuildGenerationResult } from "../shared/types";

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
  it("shows the gaming target once in a short sentence", () => {
    const draft = importedDraft({ profile: "gaming", priority: "performance", budgetWon: 2_000_000 });
    expect(generatedDraftSummaryFor(draft)).toBe("QHD 144Hz 게임용으로 골랐어요. 예산은 200만 원이에요.");
  });

  it("keeps an exact budget when it cannot be written in whole ten-thousands", () => {
    const draft = importedDraft({ profile: "office", budgetWon: 2_000_860, withinBudget: false });
    expect(generatedDraftSummaryFor(draft)).toBe("사무용으로 골랐어요. 예산은 2,000,860원이에요.");
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
