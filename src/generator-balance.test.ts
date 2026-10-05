import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildGenerationResult } from "../shared/types";
import { GeneratorBalanceControls } from "./GeneratorBalanceControls";
import { generatorBudgetAdjustmentRequestFor, generatorPartAdjustmentRequestFor } from "./generator-balance";
import { gamingSupportRequirementsFor } from "../shared/gaming-part-tiers";

function draftFor(patch: Partial<BuildGenerationResult> = {}): BuildGenerationResult {
  return {
    selection: { cpu: { partId: "cpu-5600", quantity: 1 }, gpu: { partId: "gpu-5060", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: false },
    profile: "gaming", priority: "performance", gamingResolution: "1440p", gamingRefreshRate: 144,
    memoryCapacityGb: 16, budgetWon: 1_600_000, includeNonRetail: false, listingPolicy: "retail_only",
    storageCapacityGb: 1000, hddCount: 0, totalPriceWon: 1_500_000, budgetDeltaWon: -100_000,
    withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0,
    lines: ["cpu", "motherboard", "memory", "cooler", "gpu", "psu", "case", "ssd"].map((category) => ({
      category: category as BuildGenerationResult["lines"][number]["category"], partId: `${category}-old`, name: `${category} current`, quantity: 1, priceWon: 100_000
    })),
    rationale: [], warnings: [], partTiers: { cpu: { upId: "cpu-7500f" }, gpu: { upId: "gpu-5070", downId: "gpu-3050" }, memory: { upId: "memory-32" } },
    ...patch
  };
}

describe("generated build balance requests", () => {
  it("releases platform dependencies for CPU upgrades while preserving the GPU and storage", () => {
    const request = generatorPartAdjustmentRequestFor(draftFor(), "cpu", "up");
    expect(request?.pinnedParts).toEqual({ cpu: "cpu-7500f", gpu: "gpu-old", ssd: "ssd-old" });
    expect(request?.budgetWon).toBe(1_600_000);
  });

  it("releases power and case for GPU upgrades and keeps the CPU platform", () => {
    const request = generatorPartAdjustmentRequestFor(draftFor(), "gpu", "up");
    expect(request?.pinnedParts).toEqual({ cpu: "cpu-old", motherboard: "motherboard-old", memory: "memory-old", gpu: "gpu-5070", ssd: "ssd-old" });
  });

  it("rebalances the complete build when budget changes, allowing iGPU to external GPU", () => {
    const request = generatorBudgetAdjustmentRequestFor(draftFor({ budgetWon: 800_000, selection: { cpu: { partId: "cpu-5500gt", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true } }), "up");
    expect(request).toMatchObject({ budgetWon: 900_000, includeGpu: true });
    expect(request?.pinnedParts).toBeUndefined();
    expect(generatorBudgetAdjustmentRequestFor(draftFor({ budgetWon: 800_000 }), "down")).toBeUndefined();
    expect(generatorBudgetAdjustmentRequestFor(draftFor({ budgetWon: 10_000_000 }), "up")).toBeUndefined();
  });

  it("does not send a request beyond the adjacency boundary", () => {
    expect(generatorPartAdjustmentRequestFor(draftFor(), "cpu", "down")).toBeUndefined();
  });

  it("releases the CPU platform and physical dependencies when RAM changes generation", () => {
    const request = generatorPartAdjustmentRequestFor(draftFor(), "memory", "up");
    expect(request?.pinnedParts).toEqual({ memory: "memory-32", gpu: "gpu-old", ssd: "ssd-old" });
  });

  it("sends the new actual total for RAM capacity steps while keeping its existing platform", () => {
    const draft = draftFor({ partTiers: { memory: { upId: "memory-old", upMemoryCapacityGb: 32 } } });
    const request = generatorPartAdjustmentRequestFor(draft, "memory", "up");
    expect(request?.memoryCapacityGb).toBe(32);
    expect(request?.pinnedParts).toEqual({ cpu: "cpu-old", motherboard: "motherboard-old", memory: "memory-old", cooler: "cooler-old", gpu: "gpu-old", psu: "psu-old", case: "case-old", ssd: "ssd-old" });
  });

  it("downgrades real RAM capacity and refuses invalid or reversed capacity metadata", () => {
    const draft = draftFor({ memoryCapacityGb: 32, partTiers: { memory: { downId: "memory-16", downMemoryCapacityGb: 16 } } });
    expect(generatorPartAdjustmentRequestFor(draft, "memory", "down")?.memoryCapacityGb).toBe(16);
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { memory: { upId: "memory-8", upMemoryCapacityGb: 8 } } }), "memory", "up")).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { memory: { upId: "memory-16", upMemoryCapacityGb: 16 } } }), "memory", "up")).toBeUndefined();
  });

  it("preserves an existing requested RAM capacity when the CPU platform changes", () => {
    expect(generatorPartAdjustmentRequestFor(draftFor({ memoryCapacityGb: 64 }), "cpu", "up")?.memoryCapacityGb).toBe(64);
  });

  it("sends SSD capacity changes while retaining the CPU, GPU and HDD quantity", () => {
    const draft = draftFor({ hddCount: 2, hddCapacityGb: 4000, partTiers: { ssd: { upId: "ssd-2tb", upStorageCapacityGb: 2000, downId: "ssd-500gb", downStorageCapacityGb: 500 } } });
    const up = generatorPartAdjustmentRequestFor(draft, "ssd", "up");
    expect(up).toMatchObject({ storageCapacityGb: 2000, hddCount: 2, hddCapacityGb: 4000 });
    expect(up?.pinnedParts).toMatchObject({ cpu: "cpu-old", gpu: "gpu-old", ssd: "ssd-2tb", motherboard: "motherboard-old" });
    expect(generatorPartAdjustmentRequestFor(draft, "ssd", "down")?.storageCapacityGb).toBe(500);
  });

  it("changes each HDD capacity and preserves the drive count and SSD", () => {
    const draft = draftFor({ hddCount: 2, hddCapacityGb: 4000, lines: [...draftFor().lines, { category: "hdd", partId: "hdd-old", name: "HDD 4TB", quantity: 2, priceWon: 100_000 }], partTiers: { hdd: { upId: "hdd-8tb", upHddCapacityGb: 8000, downId: "hdd-2tb", downHddCapacityGb: 2000 } } });
    const up = generatorPartAdjustmentRequestFor(draft, "hdd", "up");
    expect(up).toMatchObject({ hddCount: 2, hddCapacityGb: 8000, storageCapacityGb: 1000 });
    expect(up?.pinnedParts).toMatchObject({ hdd: "hdd-8tb", cpu: "cpu-old", gpu: "gpu-old", ssd: "ssd-old" });
    expect(up?.pinnedParts?.case).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draft, "hdd", "down")).toMatchObject({ hddCount: 2, hddCapacityGb: 2000 });
  });

  it("rejects invalid storage capacities without preventing a downgrade to the requested floor", () => {
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { ssd: { upId: "ssd-750gb", upStorageCapacityGb: 750 } } }), "ssd", "up")).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { ssd: { upId: "ssd-500gb", upStorageCapacityGb: 500 } } }), "ssd", "up")).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { ssd: { downId: "ssd-250gb", downStorageCapacityGb: 250 } } }), "ssd", "down")).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draftFor({ hddCount: 1, hddCapacityGb: 4000, partTiers: { hdd: { upId: "hdd-1tb", upHddCapacityGb: 1000 } } }), "hdd", "up")).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { hdd: { upId: "hdd-8tb", upHddCapacityGb: 8000 } } }), "hdd", "up")).toBeUndefined();
    // Generated drives can be larger than the requested floor. Persisted context
    // drops derived suitability, so a server-supplied down step may equal it.
    expect(generatorPartAdjustmentRequestFor(draftFor({ partTiers: { ssd: { downId: "ssd-1tb", downStorageCapacityGb: 1000 } } }), "ssd", "down")?.storageCapacityGb).toBe(1000);
  });

  it("releases the case when a longer power supply is selected", () => {
    const request = generatorPartAdjustmentRequestFor(draftFor({ partTiers: { psu: { upId: "psu-new" } } }), "psu", "up");
    expect(request?.pinnedParts?.psu).toBe("psu-new");
    expect(request?.pinnedParts?.case).toBeUndefined();
    expect(request?.pinnedParts?.cooler).toBeUndefined();
    expect(request?.pinnedParts?.cpu).toBe("cpu-old");
  });

  it("shows minus and plus on both sides of every selected part and the budget", () => {
    const markup = renderToStaticMarkup(createElement(GeneratorBalanceControls, { draft: draftFor(), loading: false, onGenerate: async () => undefined }));
    expect(markup).toContain('aria-label="예산 10만원 줄이기"');
    expect(markup).toContain('aria-label="예산 10만원 늘리기"');
    expect(markup).toContain('data-testid="balance-cpu:up"');
    expect(markup).toContain('data-testid="balance-cpu:down"');
    expect(markup.match(/class="generator-balance-button"/g)).toHaveLength(18);
    expect(markup).toContain("CPU를 바꾸면 보드·RAM·쿨러·파워를");
  });

  it("claims a free packaged cooler only when the CPU package includes one", () => {
    const noCooler = draftFor({ lines: draftFor().lines.filter((line) => line.category !== "cooler") });
    const markup = renderToStaticMarkup(createElement(GeneratorBalanceControls, { draft: noCooler, loading: false, onGenerate: async () => undefined }));
    expect(markup).toContain("쿨러 미선택");
    expect(markup).not.toContain("CPU에 포함된 기본 쿨러");
    const gamingSupportRequirements = gamingSupportRequirementsFor({ cpu: { id: "cpu-5600", name: "AMD Ryzen 5600", model: "5600", category: "cpu", specs: { coolerIncluded: true, tdpW: 65 }, source: "manual", dataQuality: "manual", missingFields: [], updatedAt: "2026-10-05T00:00:00.000Z" } });
    const included = renderToStaticMarkup(createElement(GeneratorBalanceControls, { draft: { ...noCooler, gamingSupportRequirements }, loading: false, onGenerate: async () => undefined }));
    expect(included).toContain("CPU에 포함된 기본 쿨러");
  });
});

it("keeps integrated graphics for same-platform RAM and motherboard adjustments", () => {
  const integrated = draftFor({ gamingMode: "budget", gamingTestbedPhase1: true, selection: { cpu: { partId: "cpu-5500gt", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }, partTiers: { memory: { upId: "memory-32", upMemoryCapacityGb: 32 }, motherboard: { upId: "motherboard-b550" } } });
  integrated.lines = integrated.lines.filter((line) => line.category !== "gpu");
  const memory = generatorPartAdjustmentRequestFor(integrated, "memory", "up")!;
  expect(memory.includeGpu).toBe(false);
  expect(memory.pinnedParts?.cpu).toBe("cpu-old");
  const board = generatorPartAdjustmentRequestFor(integrated, "motherboard", "up")!;
  expect(board.includeGpu).toBe(false);
  expect(board.pinnedParts?.cpu).toBe("cpu-old");
  expect(board.pinnedParts?.cooler).toBe("cooler-old");
});
