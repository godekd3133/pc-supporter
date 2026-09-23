import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { gamingPerformanceEvidenceRecordFromUnknown } from "../shared/gaming-performance-evidence";
import { starterCatalog } from "../server/seed-catalog-starter";
import { auditRecommendationEvidence, recommendationBaselineDiagnosticsFor } from "./recommendation-evidence-audit";

function part(id: string, category: "cpu" | "gpu", specs: Part["specs"]): Part {
  return { id, category, name: id, brand: "test", model: id, priceWon: 1, specs, source: "seed", listingType: "retail", dataQuality: "seed", missingFields: [], updatedAt: "2026-09-20T00:00:00.000Z" };
}

describe("internal recommendation evidence audit", () => {
  it("reports measured score, provenance, FPS coverage, staleness and target misses deterministically", () => {
    const catalog = [
      part("cpu-measured", "cpu", { cinebenchR23Multi: 18_000, benchmarkProvenance: { sourceKind: "independent_review", sourceNote: "review", sourceUrl: "https://example.com/cpu", updatedAt: "2026-09-01T00:00:00.000Z" } }),
      part("cpu-estimated", "cpu", { cores: 8 }),
      part("gpu-measured", "gpu", { gpu3dmarkTimeSpyScore: 20_000, benchmarkProvenance: { sourceKind: "official", sourceNote: "vendor", updatedAt: "2025-01-01T00:00:00.000Z" } })
    ];
    const evidence = [
      { id: "fresh", gameId: "cyberpunk", gpuPartId: "gpu-measured", gpuName: "Test GPU", resolution: "1440p", refreshRate: 144, graphicsPreset: "high", rayTracing: false, upscaling: "native", averageFps: 120, onePercentLowFps: 80, measuredAt: "2026-09-01T00:00:00.000Z", sourceKind: "independent_review", sourceUrl: "https://example.com/game" },
      { id: "stale", gameId: "cyberpunk", gpuPartId: "gpu-measured", gpuName: "Test GPU", resolution: "4k", refreshRate: 60, graphicsPreset: "high", rayTracing: false, upscaling: "native", averageFps: 75, measuredAt: "2025-01-01T00:00:00.000Z", sourceKind: "lab", sourceUrl: "https://example.com/old" },
      { id: "invalid", gameId: "cyberpunk", gpuPartId: "gpu-measured", gpuName: "Test GPU", resolution: "not-a-resolution" }
    ];
    const report = auditRecommendationEvidence(catalog, evidence, "2026-09-20T00:00:00.000Z");
    expect(report.benchmarkCoverage.cpu).toMatchObject({ total: 2, withAnyMeasuredScore: 1, withAllMeasuredScores: 0, withProvenance: 1, withSourceUrl: 1, anyScoreRate: 0.5, completeScoreRate: 0 });
    expect(report.benchmarkCoverage.gpu).toMatchObject({ total: 1, withAnyMeasuredScore: 1, withAllMeasuredScores: 0, staleProvenance: 1 });
    expect(report.gamingPerformance).toMatchObject({ totalRecords: 2, invalidRecords: 1, staleRecords: 1, refreshRateTargetMisses: 1, uniqueGames: 1, uniqueGpus: 1, uniqueConditions: 2, missingCoverageRate: null });
    expect(report.gamingPerformance.recordCountsByGame).toEqual({ cyberpunk: 2 });
  });

  it("runs a stable profile matrix as baseline diagnostics without ground-truth labels", () => {
    const baseline = recommendationBaselineDiagnosticsFor([], []);
    expect(baseline).toMatchObject({
      classification: "baseline_diagnostics_no_ground_truth_labels",
      scenarioCount: 4,
      outcomeCounts: { success: 0, failure: 4 },
      budgetOverrunCount: 0,
      compatibilityBlockerCount: 0,
      compatibilityUnknownCount: 0,
      gamingEvidenceStatuses: { verified: 0, partial: 0, missing: 0, target_not_met: 0, stale: 0, not_recorded: 4 }
    });
    expect(baseline.scenarios.map((scenario) => scenario.profile)).toEqual(["gaming", "creator", "development", "office"]);
    expect(baseline.scenarios[0]).toMatchObject({ gamingTarget: { gameIds: ["cyberpunk"], resolution: "1440p", refreshRate: 144 }, outcome: "failure" });
  });

  it("evaluates the fixed matrix against deterministic starter data and in-memory evidence", () => {
    const evidence = starterCatalog.filter((candidate) => candidate.category === "gpu").map((gpu) => gamingPerformanceEvidenceRecordFromUnknown({
      id: `scenario-${gpu.id}`,
      gameId: "cyberpunk",
      gpuPartId: gpu.id,
      gpuName: gpu.name,
      resolution: "1440p",
      refreshRate: 144,
      graphicsPreset: "high",
      rayTracing: false,
      upscaling: "native",
      averageFps: 180,
      onePercentLowFps: 140,
      measuredAt: "2026-09-23T00:00:00.000Z",
      sourceKind: "independent_review",
      sourceUrl: "https://example.com/performance"
    })).filter((record) => record !== null);
    const baseline = recommendationBaselineDiagnosticsFor(starterCatalog, evidence);
    expect(baseline.scenarioCount).toBe(4);
    expect(baseline.scenarios.map((scenario) => scenario.id)).toEqual([
      "gaming-1440p-cyberpunk",
      "creator-editing",
      "development-workstation",
      "office-integrated-graphics"
    ]);
    expect(baseline.scenarios.every((scenario) => ["success", "failure"].includes(scenario.outcome))).toBe(true);
    expect(baseline.gamingEvidenceStatuses.not_recorded).toBeGreaterThan(0);
    expect(baseline.scenarios.find((scenario) => scenario.id === "gaming-1440p-cyberpunk")?.gamingEvidenceStatus).toMatch(/^(verified|partial|missing|target_not_met|stale|not_recorded)$/);
  });
});
