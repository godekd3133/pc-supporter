import { describe, expect, it } from "vitest";
import type { GeneratorVariantsExportPayload } from "../shared/generator-variants-share";
import type { BuildGenerationResult } from "../shared/types";
import { generatorVariantsCustomerExportPayloadFor } from "./SharedGeneratorVariantsView";

describe("generatorVariantsCustomerExportPayloadFor", () => {
  it("removes old score fields and nested analysis from shared JSON exports", () => {
    const draft = {
      totalPriceWon: 1_000_000,
      analysis: {
        overallScore: 87,
        scoreLabel: "상위권",
        scoreBasis: "고정 기준 점수",
        confidence: "high"
      }
    } as BuildGenerationResult;
    const payload = {
      type: "pc-supporter-generator-variants",
      version: 1,
      exportedAt: "2026-09-28T00:00:00.000Z",
      items: [{ priority: "balanced", label: "균형형", status: "호환 가능", analysisScore: 87, totalPriceWon: 1_000_000, draft }]
    } as GeneratorVariantsExportPayload;

    const safePayload = generatorVariantsCustomerExportPayloadFor(payload);
    const safeItem = safePayload.items[0];

    expect(safeItem).not.toHaveProperty("analysisScore");
    expect(safeItem.draft).not.toHaveProperty("analysis");
    expect(safeItem.totalPriceWon).toBe(1_000_000);
  });
});
