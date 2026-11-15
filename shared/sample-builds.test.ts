import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { GAMING_BUDGET_TIER_GPU, SAMPLE_BUILDS, cheapestSample, resolveSampleBuild, sampleForBudgetTier, sampleLadder } from "./sample-builds";

function part(id: string, category: Part["category"], name: string, priceWon: number, extra: Partial<Part> = {}): Part {
  return { id, category, name, priceWon, source: "danawa", dataQuality: "live", listingType: "retail", specs: {}, missingFields: [], updatedAt: "2026-11-01T00:00:00.000Z", ...extra };
}

describe("sample builds", () => {
  it("maps resolution budget tiers to the developer-specified GPU classes", () => {
    expect(GAMING_BUDGET_TIER_GPU["1080p"]).toEqual({ low: "rtx5050", value: "rtx5060ti", high: "rtx5070" });
    expect(GAMING_BUDGET_TIER_GPU["1440p"]).toEqual({ low: "rtx5060ti", value: "rtx5070", high: "rtx5080" });
    expect(GAMING_BUDGET_TIER_GPU["4k"]).toEqual({ low: "rtx5070ti", value: "rtx5080", high: "rtx5090" });
    expect(sampleForBudgetTier("1080p", "low")?.id).toBe("s3-fhd-entry");
  });

  it("uses the cheapest sample for light office use", () => {
    expect(cheapestSample().id).toBe("s1-office");
  });

  it("prefers an X3D CPU sample for popular online games when one exists", () => {
    expect(sampleForBudgetTier("1080p", "value", { preferX3d: true })?.x3dCpu).toBe(true);
    expect(sampleForBudgetTier("1080p", "value")?.x3dCpu).toBeFalsy();
    // RTX 5050 등급에는 X3D 견본이 없어 기본 견본을 쓴다.
    expect(sampleForBudgetTier("1080p", "low", { preferX3d: true })?.id).toBe("s3-fhd-entry");
    const ladder = sampleLadder({ preferX3d: true });
    expect(ladder.map((sample) => sample.order)).toEqual([...new Set(SAMPLE_BUILDS.map((sample) => sample.order))].sort((a, b) => a - b));
  });

  it("resolves name tokens to the most popular sellable listing, excluding variants", () => {
    const catalog = [
      part("gpu-a", "gpu", "MSI 지포스 RTX 5050 벤투스 D6 8GB", 560_000, { popularityRank: 9 }),
      part("gpu-b", "gpu", "GIGABYTE 지포스 RTX 5050 WINDFORCE OC D6 8GB", 600_000, { popularityRank: 2 }),
      part("gpu-seed", "gpu", "RTX 5050 기준", 400_000, { source: "seed", dataQuality: "seed" }),
      part("cpu-14400f", "cpu", "인텔 코어i5-14세대 14400F (랩터레이크 리프레시) (벌크)", 230_000),
      part("mb-gen5", "motherboard", "GIGABYTE B760M DS3H D4 GEN5", 130_000, { popularityRank: 1 }),
      part("mb", "motherboard", "GIGABYTE B760M DS3H D4 피씨디렉트", 123_000, { popularityRank: 5 }),
      part("ram", "memory", "ESSENCORE KLEVV DDR4-3200 CL16 BOLT X (8GB)", 30_000)
    ];
    const sample = SAMPLE_BUILDS.find((entry) => entry.id === "s3-fhd-entry")!;
    const { resolved } = resolveSampleBuild(sample, catalog);
    expect(resolved.selection.gpu?.partId).toBe("gpu-b");
    expect(resolved.selection.motherboard?.partId).toBe("mb");
    expect(resolved.selection.memory).toEqual([{ partId: "ram", quantity: 2 }]);
    expect(resolved.unresolved).toEqual(expect.arrayContaining(["잘만 N30 백사십 블랙"]));
    expect(resolved.priceComplete).toBe(false);
    expect(resolved.totalPriceWon).toBe(230_000 + 123_000 + 60_000 + 600_000);
  });
});

describe("budget-based sample selection", () => {
  const resolved = (id: string, order: number, totalPriceWon: number) => ({ id, order, title: id, gpuClass: "igpu" as const, x3dCpu: false, provisional: false, evaluation: [], lines: [], selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }, totalPriceWon, priceComplete: true, unresolved: [] });
  it("picks the highest ladder sample within budget and falls back to the cheapest", async () => {
    const { resolvedSampleForBudget } = await import("./sample-builds");
    const samples = [resolved("s1-office", 1, 870_000), resolved("s2-budget-gaming", 2, 1_030_000), resolved("s3-fhd-entry", 3, 1_650_000), resolved("s4x-fhd-value-x3d", 4, 2_400_000)];
    expect(resolvedSampleForBudget(samples, 1_200_000)?.id).toBe("s2-budget-gaming");
    expect(resolvedSampleForBudget(samples, 3_000_000)?.id).toBe("s3-fhd-entry"); // X3D 변형은 기본 사다리가 아니다
    expect(resolvedSampleForBudget(samples, 500_000)?.id).toBe("s1-office");
  });
});
