import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildGenerationResult, CpuGpuBalanceAssessment } from "../shared/types";
import { BuildGeneratorView, GeneratorPlatformToggle, generatorDisplayedPlatformFor } from "./BuildGeneratorView";
import { CpuGpuBalanceRow, GeneratorBalanceControls } from "./GeneratorBalanceControls";

const draft: BuildGenerationResult = {
  status: "compatible", profile: "gaming", priority: "balanced", listingPolicy: "include_bulk", totalPriceWon: 759_640,
  budgetWon: 800_000, budgetDeltaWon: -40_360, withinBudget: true, priceComplete: true, includeNonRetail: true,
  blockerCount: 0, warningCount: 0, unknownCount: 0, memoryCapacityGb: 16, storageCapacityGb: 1000, hddCount: 0,
  gamingResolution: "1440p", gamingRefreshRate: 144,
  selection: { cpu: { partId: "cpu", quantity: 1 }, memory: [{ partId: "ram", quantity: 1 }], ssd: [{ partId: "ssd", quantity: 1 }], hdd: [], useIntegratedGraphics: true },
  lines: [
    { category: "cpu", partId: "cpu", name: "AMD Ryzen 5500GT", quantity: 1, priceWon: 150_000 },
    { category: "memory", partId: "ram", name: "KLEVV DDR4", quantity: 1, priceWon: 126_000, specSummary: "DDR4 / 16GB" },
    { category: "ssd", partId: "ssd", name: "KLEVV C910G", quantity: 1, priceWon: 100_000, specSummary: "1TB" }
  ], warnings: [], rationale: []
};

describe("compact quote result", () => {
  it("keeps total and delta by the editable parts, without budget stepper controls", () => {
    const markup = renderToStaticMarkup(createElement(GeneratorBalanceControls, { draft, loading: false, onGenerate: async () => undefined, onPickPart: () => undefined }));
    expect(markup).toContain("759,640원");
    expect(markup).toContain("40,360원 여유");
    expect(markup).toContain('aria-label="CPU 직접 선택"');
    expect(markup).toContain('aria-label="SSD 직접 선택"');
    expect(markup).not.toContain('data-testid="balance-budget:');
    expect(markup).not.toContain("예산 10만원");
    expect(markup).not.toContain('data-testid="cpu-gpu-balance"');
  });

  it("removes context boxes and requirement tabs while keeping editable budget input", () => {
    const noop = async () => undefined;
    const markup = renderToStaticMarkup(createElement(BuildGeneratorView, {
      initialProfile: "gaming", draft, variants: [], budgetLadder: [], loading: false,
      onGenerate: noop, onAdjustDraft: noop, onGenerateVariants: noop, onGenerateBudgetLadder: noop, onApply: noop,
      onToast: () => undefined, onBudgetLadderShareSaved: () => undefined, onBudgetLadderShareRevoked: () => undefined,
      onEditPresetInOnboarding: () => undefined, onBack: () => undefined
    }));
    expect(markup).toContain("목표 예산");
    expect(markup).toContain('inputMode="numeric"');
    expect(markup).toContain('aria-label="CPU 종류"');
    expect(markup).toContain('aria-label="RAM 종류"');
    for (const removed of ["generator-work-context", "필요 사양", "권장 사양", "performance-index-heading", "CPU 테스트 영상"]) expect(markup).not.toContain(removed);
  });

  it("reports all five grades and treats unknown evidence separately from good", () => {
    const levels = ["too_weak", "slightly_weak", "good", "slightly_strong", "too_strong"] as const;
    const labels = ["너무 약함", "살짝 약함", "좋음", "살짝 강함", "너무 강함"];
    levels.forEach((level, index) => {
      const assessment: CpuGpuBalanceAssessment = { cpu: { level }, gpu: { level: "good" }, recommendedCpuModels: [], evidence: "derived_policy" };
      const markup = renderToStaticMarkup(createElement(CpuGpuBalanceRow, { assessment }));
      expect(markup).toContain(labels[index]);
      expect(markup).toContain(`balance-${level}`);
    });
    const unknown = renderToStaticMarkup(createElement(CpuGpuBalanceRow, {}));
    expect(unknown).toBe("");
  });

  it("displays current hardware automatically without creating a preference", () => {
    const current = { ...draft, lines: [{ ...draft.lines[0], name: "Intel Core i5-14600K" }, { ...draft.lines[1], name: "KLEVV DDR5", specSummary: "DDR5 / 32GB" }] };
    expect(generatorDisplayedPlatformFor(current)).toEqual({ cpuVendor: "intel", memoryType: "DDR5" });
    expect(current.cpuVendorPreference).toBeUndefined();
    expect(current.memoryTypePreference).toBeUndefined();
    const markup = renderToStaticMarkup(createElement(GeneratorPlatformToggle, { label: "CPU", values: ["amd", "intel"] as const, value: "intel", explicit: false, disabled: false, onChange: () => undefined }));
    expect(markup).toContain("자동 / 현재 구성");
    expect(markup).toContain('data-platform-value="intel"');
    expect(markup).toContain('aria-checked="true"');
  });
});
