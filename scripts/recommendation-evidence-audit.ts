import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BuildGenerationRequest, BuildGenerationResult, GamingPerformanceEvidenceStatus, Part } from "../shared/types";
import { gamingPerformanceEvidenceRecordFromUnknown, GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS, type GamingPerformanceEvidenceRecord } from "../shared/gaming-performance-evidence";
import { generateBuildDraft } from "../server/engine";

const BENCHMARK_KEYS = ["cinebenchR23Single", "cinebenchR23Multi"] as const;
const GPU_BENCHMARK_KEYS = ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
// Keep in sync with server/engine.ts generatorPerformanceDimensions validity window.
const BENCHMARK_PROVENANCE_STALE_DAYS = 365;
const SCENARIO_REQUESTS: Array<{ id: string; request: BuildGenerationRequest }> = [
  { id: "gaming-1440p-cyberpunk", request: { profile: "gaming", priority: "balanced", budgetWon: 2_200_000, includeGpu: true, gamingResolution: "1440p", gamingRefreshRate: 144, gamingGameIds: ["cyberpunk"], gamingGraphicsPreset: "high", gamingRayTracing: false, gamingUpscaling: "native" } },
  { id: "creator-editing", request: { profile: "creator", priority: "balanced", budgetWon: 2_000_000, includeGpu: true } },
  { id: "development-workstation", request: { profile: "development", priority: "balanced", budgetWon: 1_800_000, includeGpu: true } },
  { id: "office-integrated-graphics", request: { profile: "office", priority: "budget", budgetWon: 1_200_000, includeGpu: false } }
];

type Coverage = { total: number; withAnyMeasuredScore: number; withAllMeasuredScores: number; withProvenance: number; withSourceUrl: number; staleProvenance: number };

function coverageFor(parts: Part[], keys: readonly string[], nowMs: number): Coverage {
  const coverage: Coverage = { total: parts.length, withAnyMeasuredScore: 0, withAllMeasuredScores: 0, withProvenance: 0, withSourceUrl: 0, staleProvenance: 0 };
  for (const part of parts) {
    const present = keys.filter((key) => typeof part.specs[key as keyof typeof part.specs] === "number");
    if (present.length) coverage.withAnyMeasuredScore += 1;
    if (present.length === keys.length) coverage.withAllMeasuredScores += 1;
    const provenance = part.specs.benchmarkProvenance;
    if (!provenance) continue;
    coverage.withProvenance += 1;
    if (provenance.sourceUrl) coverage.withSourceUrl += 1;
    const measuredAt = Date.parse(provenance.updatedAt);
    if (!Number.isFinite(measuredAt) || nowMs - measuredAt > BENCHMARK_PROVENANCE_STALE_DAYS * DAY_MS) coverage.staleProvenance += 1;
  }
  return coverage;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export function auditRecommendationEvidence(catalog: Part[], rawEvidence: unknown, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const input = Array.isArray(rawEvidence) ? rawEvidence : [];
  const evidence = input.map(gamingPerformanceEvidenceRecordFromUnknown).filter((record): record is GamingPerformanceEvidenceRecord => record !== null);
  const cpu = catalog.filter((part) => part.category === "cpu");
  const gpu = catalog.filter((part) => part.category === "gpu");
  const cpuCoverage = coverageFor(cpu, BENCHMARK_KEYS, nowMs);
  const gpuCoverage = coverageFor(gpu, GPU_BENCHMARK_KEYS, nowMs);
  const byGame = new Map<string, number>();
  const byGpu = new Map<string, number>();
  const byCondition = new Map<string, number>();
  for (const record of evidence) {
    byGame.set(record.gameId, (byGame.get(record.gameId) ?? 0) + 1);
    byGpu.set(record.gpuPartId, (byGpu.get(record.gpuPartId) ?? 0) + 1);
    const condition = [record.gameId, record.gpuPartId, record.resolution, record.refreshRate, record.graphicsPreset, record.rayTracing ? "rt" : "raster", record.upscaling].join("|");
    byCondition.set(condition, (byCondition.get(condition) ?? 0) + 1);
  }
  const staleCount = evidence.filter((record) => {
    const timestamp = Date.parse(record.measuredAt);
    return !Number.isFinite(timestamp) || nowMs - timestamp > GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS * DAY_MS;
  }).length;
  const targetMissCount = evidence.filter((record) => record.averageFps < record.refreshRate).length;
  return {
    generatedAt: new Date(nowMs).toISOString(),
    scope: "local-catalog-and-gaming-performance-evidence",
    benchmarkCoverage: {
      benchmarkProvenanceStaleDays: BENCHMARK_PROVENANCE_STALE_DAYS,
      cpu: { ...cpuCoverage, anyScoreRate: ratio(cpuCoverage.withAnyMeasuredScore, cpu.length), completeScoreRate: ratio(cpuCoverage.withAllMeasuredScores, cpu.length) },
      gpu: { ...gpuCoverage, anyScoreRate: ratio(gpuCoverage.withAnyMeasuredScore, gpu.length), completeScoreRate: ratio(gpuCoverage.withAllMeasuredScores, gpu.length) }
    },
    gamingPerformance: {
      totalRecords: evidence.length,
      invalidRecords: input.length - evidence.length,
      sourceUrlCoverageRate: ratio(evidence.filter((record) => Boolean(record.sourceUrl)).length, evidence.length),
      onePercentLowCoverageRate: ratio(evidence.filter((record) => record.onePercentLowFps !== undefined).length, evidence.length),
      staleDays: GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS,
      staleRecords: staleCount,
      staleRate: ratio(staleCount, evidence.length),
      refreshRateTargetMisses: targetMissCount,
      refreshRateTargetMissRate: ratio(targetMissCount, evidence.length),
      uniqueGames: byGame.size,
      uniqueGpus: byGpu.size,
      uniqueConditions: byCondition.size,
      recordCountsByGame: Object.fromEntries([...byGame.entries()].sort(([a], [b]) => a.localeCompare(b))),
      recordCountsByGpuPartId: Object.fromEntries([...byGpu.entries()].sort(([a], [b]) => a.localeCompare(b))),
      recordCountsByCondition: Object.fromEntries([...byCondition.entries()].sort(([a], [b]) => a.localeCompare(b))),
      missingCoverageRate: null,
      missingCoverageRateReason: "A complete target matrix of game, GPU, resolution, refresh rate, preset, ray tracing, and upscaling conditions is not defined in local data."
    },
    recommendationBaselineDiagnostics: recommendationBaselineDiagnosticsFor(catalog, evidence)
  };
}

const GAMING_STATUSES: GamingPerformanceEvidenceStatus[] = ["verified", "partial", "missing", "target_not_met", "stale", "not_recorded"];

function compactScenarioResult(result: BuildGenerationResult) {
  return {
    outcome: "success" as const,
    totalPriceWon: result.totalPriceWon,
    budgetWon: result.budgetWon,
    budgetOverrunWon: Math.max(0, result.totalPriceWon - result.budgetWon),
    withinBudget: result.withinBudget,
    compatibilityStatus: result.status,
    blockerCount: result.blockerCount,
    unknownCount: result.unknownCount,
    gamingEvidenceStatus: result.gamingPerformanceAssessment?.status ?? "not_recorded",
    selectedPartIds: result.lines.map((line) => line.partId)
  };
}

export function recommendationBaselineDiagnosticsFor(catalog: Part[], evidence: readonly GamingPerformanceEvidenceRecord[]) {
  const results = SCENARIO_REQUESTS.map(({ id, request }) => {
    try {
      const result = generateBuildDraft(catalog, request, evidence);
      return { id, request, ...compactScenarioResult(result) };
    } catch (error) {
      return {
        id,
        request,
        outcome: "failure" as const,
        error: error instanceof Error ? error.message : String(error),
        totalPriceWon: null,
        budgetWon: request.budgetWon,
        budgetOverrunWon: null,
        withinBudget: null,
        compatibilityStatus: null,
        blockerCount: null,
        unknownCount: null,
        gamingEvidenceStatus: "not_recorded" as const,
        selectedPartIds: [] as string[]
      };
    }
  });
  const gamingEvidenceStatuses = Object.fromEntries(GAMING_STATUSES.map((status) => [status, 0])) as Record<GamingPerformanceEvidenceStatus, number>;
  let budgetOverrunCount = 0;
  let compatibilityBlockerCount = 0;
  let compatibilityUnknownCount = 0;
  for (const result of results) {
    gamingEvidenceStatuses[result.gamingEvidenceStatus] += 1;
    if (result.budgetOverrunWon !== null && result.budgetOverrunWon > 0) budgetOverrunCount += 1;
    compatibilityBlockerCount += result.blockerCount ?? 0;
    compatibilityUnknownCount += result.unknownCount ?? 0;
  }
  return {
    classification: "baseline_diagnostics_no_ground_truth_labels",
    scenarioCount: results.length,
    outcomeCounts: {
      success: results.filter((result) => result.outcome === "success").length,
      failure: results.filter((result) => result.outcome === "failure").length
    },
    budgetOverrunCount,
    compatibilityBlockerCount,
    compatibilityUnknownCount,
    gamingEvidenceStatuses,
    scenarios: results.map(({ id, request, ...result }) => ({
      id,
      profile: request.profile,
      budgetWon: request.budgetWon,
      ...(request.profile === "gaming" ? { gamingTarget: {
        gameIds: request.gamingGameIds,
        resolution: request.gamingResolution,
        refreshRate: request.gamingRefreshRate,
        graphicsPreset: request.gamingGraphicsPreset,
        rayTracing: request.gamingRayTracing,
        upscaling: request.gamingUpscaling
      } } : {}),
      ...result
    }))
  };
}

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const [catalogRaw, evidenceRaw] = await Promise.all([
    readFile(resolve(root, "data/catalog.json"), "utf8"),
    readFile(resolve(root, "data/gaming-performance-evidence.json"), "utf8")
  ]);
  const report = auditRecommendationEvidence(JSON.parse(catalogRaw) as Part[], JSON.parse(evidenceRaw));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
