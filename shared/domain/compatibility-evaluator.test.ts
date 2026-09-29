import { describe, expect, it } from "vitest";
import type { CompatibilityResult } from "../types";
import { compatibilityResultForPublicTransport } from "./compatibility-evaluator";

describe("compatibility evaluator public transport", () => {
  it("replaces full upgrade bundles before public evidence projection", () => {
    const result = {
      status: "compatible",
      blockerCount: 0,
      warningCount: 0,
      unknownCount: 0,
      findings: [],
      metrics: {},
      analysis: { overallScore: 99, scoreLabel: "internal" },
      upgradeBundles: [],
      links: [],
      totalPriceWon: 0,
      priceComplete: true,
      engineVersion: "fixture",
      catalogSnapshotAt: "2026-09-29T00:00:00.000Z",
      checkedAt: "2026-09-29T00:00:00.000Z"
    } as unknown as CompatibilityResult;

    const payload = compatibilityResultForPublicTransport(result) as unknown as Record<string, unknown>;

    expect(payload).not.toHaveProperty("upgradeBundles");
    expect(payload).not.toHaveProperty("analysis");
    expect(payload.upgradeBundlePayload).toBeDefined();
  });
});
