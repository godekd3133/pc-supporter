import type { BenchmarkReviewItem, BenchmarkReviewQueue, BenchmarkScoreKey, BenchmarkSourceReviewItem, DataQuality, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { classifyDataFreshness } from "./data-health";

export const CPU_BENCHMARK_SCORE_KEYS = ["cinebenchR23Single", "cinebenchR23Multi"] as const satisfies readonly BenchmarkScoreKey[];
export const GPU_BENCHMARK_SCORE_KEYS = ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] as const satisfies readonly BenchmarkScoreKey[];

const scoreLabels: Record<BenchmarkScoreKey, string> = {
  cinebenchR23Single: "R23 싱글",
  cinebenchR23Multi: "R23 멀티",
  gpu3dmarkTimeSpyScore: "Time Spy",
  gpu3dmarkPortRoyalScore: "Port Royal"
};

const qualityPoints: Record<DataQuality, number> = { live: 10, manual: 9, seed: 5, incomplete: 0 };
const qualityRank: Record<DataQuality, number> = { live: 4, manual: 3, seed: 2, incomplete: 1 };

function scoreKeysFor(part: Part) {
  return part.category === "cpu" ? CPU_BENCHMARK_SCORE_KEYS : GPU_BENCHMARK_SCORE_KEYS;
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function reviewItemFor(part: Part, now: string | number): BenchmarkReviewItem | undefined {
  if (part.category !== "cpu" && part.category !== "gpu") return undefined;
  const keys = scoreKeysFor(part);
  const presentScores = Object.fromEntries(keys.filter((key) => validScore(part.specs[key])).map((key) => [key, part.specs[key]])) as Partial<Record<BenchmarkScoreKey, number>>;
  const missingScores = keys.filter((key) => presentScores[key] === undefined);
  const benchmarkUpdatedAt = part.specs.benchmarkProvenance?.updatedAt ?? part.updatedAt;
  const benchmarkFreshness = classifyDataFreshness(benchmarkUpdatedAt, now);
  const status: BenchmarkReviewItem["status"] | undefined = missingScores.length === keys.length
    ? "missing"
    : missingScores.length > 0
      ? "partial"
      : benchmarkFreshness === "stale" || benchmarkFreshness === "unknown"
        ? "stale"
        : undefined;
  if (!status) return undefined;
  let reviewPriorityScore = status === "missing" ? 65 : status === "partial" ? 80 : 55;
  reviewPriorityScore += qualityPoints[part.dataQuality];
  if (isKnownPrice(part.priceWon)) reviewPriorityScore += 5;
  if (part.missingFields.length === 0) reviewPriorityScore += 5;
  if (part.danawaUrl) reviewPriorityScore += 3;
  if (benchmarkFreshness === "stale") reviewPriorityScore += 5;
  if (benchmarkFreshness === "unknown") reviewPriorityScore += 8;
  const missingLabel = missingScores.length > 0 ? `${missingScores.map((key) => scoreLabels[key]).join("·")} 미확인` : "완전 세트";
  const freshnessReason = status === "stale" ? `벤치마크 ${benchmarkFreshness === "unknown" ? "시점 불명" : "갱신 필요"}` : undefined;
  const reviewReason = [missingLabel, freshnessReason, part.dataQuality === "live" ? "다나와 최신" : part.dataQuality === "manual" ? "수동 검수" : part.dataQuality === "seed" ? "프로젝트 기준" : "일부 스펙 부족"].filter(Boolean).join(" · ");
  return {
    partId: part.id,
    partName: part.name,
    category: part.category,
    status,
    reviewPriorityScore: Math.min(100, reviewPriorityScore),
    reviewReason,
    missingScores,
    presentScores,
    dataQuality: part.dataQuality,
    missingFields: part.missingFields,
    priceKnown: isKnownPrice(part.priceWon),
    ...(isKnownPrice(part.priceWon) ? { priceWon: part.priceWon } : {}),
    updatedAt: part.updatedAt,
    ...(benchmarkUpdatedAt ? { benchmarkUpdatedAt } : {}),
    benchmarkFreshness,
    ...(part.danawaUrl ? { sourceUrl: part.danawaUrl } : {}),
    ...(part.specs.benchmarkProvenance?.sourceKind ? { benchmarkSourceKind: part.specs.benchmarkProvenance.sourceKind } : {})
  };
}

function sourceReviewItemFor(part: Part, now: string | number): BenchmarkSourceReviewItem | undefined {
  if (part.category !== "cpu" && part.category !== "gpu") return undefined;
  if (part.specs.benchmarkProvenance?.sourceKind) return undefined;
  const keys = scoreKeysFor(part);
  const presentScores = Object.fromEntries(keys.filter((key) => validScore(part.specs[key])).map((key) => [key, part.specs[key]])) as Partial<Record<BenchmarkScoreKey, number>>;
  if (Object.keys(presentScores).length === 0) return undefined;
  const missingScores = keys.filter((key) => presentScores[key] === undefined);
  const benchmarkUpdatedAt = part.specs.benchmarkProvenance?.updatedAt ?? part.updatedAt;
  const benchmarkFreshness = classifyDataFreshness(benchmarkUpdatedAt, now);
  let reviewPriorityScore = missingScores.length === 0 ? 58 : 48;
  reviewPriorityScore += qualityPoints[part.dataQuality];
  if (isKnownPrice(part.priceWon)) reviewPriorityScore += 5;
  if (part.missingFields.length === 0) reviewPriorityScore += 5;
  if (part.danawaUrl) reviewPriorityScore += 3;
  if (benchmarkFreshness === "stale") reviewPriorityScore += 5;
  if (benchmarkFreshness === "unknown") reviewPriorityScore += 8;
  const missingLabel = missingScores.length > 0 ? `${missingScores.map((key) => scoreLabels[key]).join("·")} 미확인` : "완전 세트";
  return {
    partId: part.id,
    partName: part.name,
    category: part.category,
    reviewPriorityScore: Math.min(100, reviewPriorityScore),
    reviewReason: `${missingLabel} · 출처 유형 미분류`,
    missingScores,
    presentScores,
    dataQuality: part.dataQuality,
    missingFields: part.missingFields,
    priceKnown: isKnownPrice(part.priceWon),
    ...(isKnownPrice(part.priceWon) ? { priceWon: part.priceWon } : {}),
    updatedAt: part.updatedAt,
    ...(benchmarkUpdatedAt ? { benchmarkUpdatedAt } : {}),
    benchmarkFreshness,
    ...(part.danawaUrl ? { sourceUrl: part.danawaUrl } : {})
  };
}

function sortReviewItems(left: BenchmarkReviewItem, right: BenchmarkReviewItem) {
  return right.reviewPriorityScore - left.reviewPriorityScore
    || qualityRank[right.dataQuality] - qualityRank[left.dataQuality]
    || Number(right.priceKnown) - Number(left.priceKnown)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.partName.localeCompare(right.partName, "ko-KR")
    || left.partId.localeCompare(right.partId);
}

function interleaveByCategory<T extends { category: "cpu" | "gpu" }>(items: Record<"cpu" | "gpu", T[]>, limit: number) {
  const result: T[] = [];
  const indexes = { cpu: 0, gpu: 0 };
  const categoryLimit = Math.ceil(limit / 2);
  const categoryCounts = { cpu: 0, gpu: 0 };
  while (result.length < limit && (indexes.cpu < items.cpu.length || indexes.gpu < items.gpu.length)) {
    let progressed = false;
    for (const category of ["cpu", "gpu"] as const) {
      if (result.length >= limit) break;
      const otherCategory = category === "cpu" ? "gpu" : "cpu";
      const otherHasItems = indexes[otherCategory] < items[otherCategory].length;
      if (categoryCounts[category] >= categoryLimit && otherHasItems) continue;
      const item = items[category][indexes[category]];
      if (!item) continue;
      result.push(item);
      indexes[category] += 1;
      categoryCounts[category] += 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  if (result.length < limit) {
    for (const category of ["cpu", "gpu"] as const) {
      while (result.length < limit && indexes[category] < items[category].length) {
        result.push(items[category][indexes[category]]);
        indexes[category] += 1;
      }
    }
  }
  return result;
}

export function benchmarkReviewQueueFor(catalog: Part[], limit = 100, now: string | number = Date.now()): BenchmarkReviewQueue {
  const normalizedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const categorized = {
    cpu: catalog.filter((part) => part.category === "cpu"),
    gpu: catalog.filter((part) => part.category === "gpu")
  };
  const reviewItems = {
    cpu: categorized.cpu.map((part) => reviewItemFor(part, now)).filter((item): item is BenchmarkReviewItem => Boolean(item)).sort(sortReviewItems),
    gpu: categorized.gpu.map((part) => reviewItemFor(part, now)).filter((item): item is BenchmarkReviewItem => Boolean(item)).sort(sortReviewItems)
  };
  const sourceReviewItems = {
    cpu: categorized.cpu.map((part) => sourceReviewItemFor(part, now)).filter((item): item is BenchmarkSourceReviewItem => Boolean(item)).sort((left, right) => right.reviewPriorityScore - left.reviewPriorityScore || right.updatedAt.localeCompare(left.updatedAt) || left.partName.localeCompare(right.partName, "ko-KR") || left.partId.localeCompare(right.partId)),
    gpu: categorized.gpu.map((part) => sourceReviewItemFor(part, now)).filter((item): item is BenchmarkSourceReviewItem => Boolean(item)).sort((left, right) => right.reviewPriorityScore - left.reviewPriorityScore || right.updatedAt.localeCompare(left.updatedAt) || left.partName.localeCompare(right.partName, "ko-KR") || left.partId.localeCompare(right.partId))
  };
  const countStatus = (items: BenchmarkReviewItem[], status: BenchmarkReviewItem["status"]) => items.filter((item) => item.status === status).length;
  const totals = {
    cpu: {
      total: categorized.cpu.length,
      complete: categorized.cpu.length - reviewItems.cpu.length,
      partial: countStatus(reviewItems.cpu, "partial"),
      missing: countStatus(reviewItems.cpu, "missing"),
      stale: countStatus(reviewItems.cpu, "stale")
    },
    gpu: {
      total: categorized.gpu.length,
      complete: categorized.gpu.length - reviewItems.gpu.length,
      partial: countStatus(reviewItems.gpu, "partial"),
      missing: countStatus(reviewItems.gpu, "missing"),
      stale: countStatus(reviewItems.gpu, "stale")
    }
  };
  return {
    generatedAt: new Date().toISOString(),
    limit: normalizedLimit,
    items: interleaveByCategory(reviewItems, normalizedLimit),
    sourceItems: interleaveByCategory(sourceReviewItems, normalizedLimit),
    sourceTotals: {
      cpu: { benchmarked: categorized.cpu.filter((part) => CPU_BENCHMARK_SCORE_KEYS.some((key) => validScore(part.specs[key]))).length, unclassified: sourceReviewItems.cpu.length },
      gpu: { benchmarked: categorized.gpu.filter((part) => GPU_BENCHMARK_SCORE_KEYS.some((key) => validScore(part.specs[key]))).length, unclassified: sourceReviewItems.gpu.length }
    },
    totals
  };
}
