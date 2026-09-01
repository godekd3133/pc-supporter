import { isKnownPrice, type CompatibilityResult } from "./types";

export type BuildComparisonMetricResult = {
  status: CompatibilityResult["status"];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  priceComplete: boolean;
  totalPriceWon: number;
  analysis?: CompatibilityResult["analysis"];
  metrics?: CompatibilityResult["metrics"];
};

export type SavedBuildComparisonEntry = {
  id: string;
  name: string;
  result: BuildComparisonMetricResult;
};

export type SavedBuildComparisonDecisionKind = "compatibility" | "price" | "analysis" | "expansion";

export type SavedBuildComparisonDecision = {
  kind: SavedBuildComparisonDecisionKind;
  entry: SavedBuildComparisonEntry;
  metric: number;
};

export type SavedBuildComparisonRanking = {
  entry: SavedBuildComparisonEntry;
  rank?: number;
  metric?: number;
  eligible: boolean;
  reason?: string;
};

const statusRank: Record<BuildComparisonMetricResult["status"], number> = {
  compatible: 0,
  needs_review: 1,
  incompatible: 2
};

export function savedBuildComparisonRiskScoreFor(result: BuildComparisonMetricResult) {
  return result.blockerCount * 100 + result.warningCount * 10 + result.unknownCount;
}

export type SavedBuildComparisonExpansionResult = {
  score?: number;
  knownDimensionCount: number;
  totalDimensionCount: number;
  level: "complete" | "limited" | "unavailable";
  summary: string;
  details: string[];
};

type ExpansionDimension = {
  label: string;
  weight: number;
  applicable: boolean;
  headroom?: number;
  capacity?: number;
  detail?: string;
};

function expansionDimensionScoreFor(dimension: ExpansionDimension) {
  if (!dimension.applicable || dimension.headroom === undefined || dimension.capacity === undefined || !Number.isFinite(dimension.headroom) || !Number.isFinite(dimension.capacity) || dimension.capacity <= 0) return undefined;
  return Math.max(0, Math.min(100, (dimension.headroom / dimension.capacity) * 100));
}

function expansionDimensionDetailFor(dimension: ExpansionDimension, score: number) {
  return `${dimension.label} ${Math.round(score)}점 · ${dimension.detail ?? "여유 수치 확인"}`;
}

export function savedBuildComparisonExpansionFor(metrics: CompatibilityResult["metrics"] | undefined): SavedBuildComparisonExpansionResult {
  if (!metrics) return { knownDimensionCount: 0, totalDimensionCount: 0, level: "unavailable", summary: "확장성 데이터 부족 · 확인된 지표 없음", details: [] };

  const memoryCapacity = metrics.totalMemoryGb !== undefined && metrics.memoryHeadroomGb !== undefined
    ? Math.max(metrics.totalMemoryGb + metrics.memoryHeadroomGb, metrics.totalMemoryGb, 1)
    : undefined;
  const hddHeadroom = metrics.hddBayHeadroom ?? (metrics.hddBaysTotal !== undefined ? metrics.hddBaysTotal - (metrics.hddUsed ?? 0) : undefined);
  const dimensions: ExpansionDimension[] = [
    { label: "메모리 용량", weight: 18, applicable: metrics.totalMemoryGb !== undefined || metrics.memoryHeadroomGb !== undefined, headroom: metrics.memoryHeadroomGb, capacity: memoryCapacity, detail: metrics.totalMemoryGb !== undefined && metrics.memoryHeadroomGb !== undefined ? `현재 ${metrics.totalMemoryGb}GB 사용 · ${metrics.memoryHeadroomGb}GB 여유` : undefined },
    { label: "RAM 슬롯", weight: 12, applicable: metrics.memorySlotsUsed !== undefined || metrics.memorySlotsTotal !== undefined || metrics.memorySlotHeadroom !== undefined, headroom: metrics.memorySlotHeadroom, capacity: metrics.memorySlotsTotal, detail: metrics.memorySlotsUsed !== undefined && metrics.memorySlotsTotal !== undefined ? `${metrics.memorySlotsUsed}/${metrics.memorySlotsTotal}개 사용 · ${metrics.memorySlotHeadroom ?? "?"}개 여유` : undefined },
    { label: "M.2 슬롯", weight: 14, applicable: metrics.m2Used !== undefined || metrics.m2SlotsTotal !== undefined || metrics.m2Headroom !== undefined, headroom: metrics.m2Headroom, capacity: metrics.m2SlotsTotal, detail: metrics.m2Used !== undefined && metrics.m2SlotsTotal !== undefined ? `${metrics.m2Used}/${metrics.m2SlotsTotal}개 사용 · ${metrics.m2Headroom ?? "?"}개 여유` : undefined },
    { label: "SATA 포트", weight: 10, applicable: metrics.sataUsed !== undefined || metrics.sataPortsTotal !== undefined || metrics.sataHeadroom !== undefined, headroom: metrics.sataHeadroom, capacity: metrics.sataPortsTotal, detail: metrics.sataUsed !== undefined && metrics.sataPortsTotal !== undefined ? `${metrics.sataUsed}/${metrics.sataPortsTotal}개 사용 · ${metrics.sataHeadroom ?? "?"}개 여유` : undefined },
    { label: "HDD 베이", weight: 8, applicable: metrics.hddUsed !== undefined || metrics.hddBaysTotal !== undefined || metrics.hddBayHeadroom !== undefined, headroom: hddHeadroom, capacity: metrics.hddBaysTotal, detail: metrics.hddBaysTotal !== undefined ? `${metrics.hddUsed ?? 0}/${metrics.hddBaysTotal}개 사용 · ${hddHeadroom ?? "?"}개 여유` : undefined },
    { label: "전력 여유", weight: 16, applicable: metrics.powerHeadroomW !== undefined || metrics.psuWattageW !== undefined || metrics.recommendedPsuW !== undefined || metrics.gpuPowerW !== undefined, headroom: metrics.powerHeadroomW, capacity: metrics.psuWattageW ?? metrics.recommendedPsuW, detail: metrics.powerHeadroomW !== undefined ? `${metrics.psuWattageW ?? "?"}W 파워 · ${metrics.powerHeadroomW}W 여유` : undefined },
    { label: "냉각 여유", weight: 10, applicable: metrics.coolerHeadroomW !== undefined || metrics.coolerCapacityW !== undefined || metrics.cpuPowerW !== undefined, headroom: metrics.coolerHeadroomW, capacity: metrics.coolerCapacityW, detail: metrics.coolerHeadroomW !== undefined ? `${metrics.coolerCapacityW ?? "?"}W 냉각 · ${metrics.coolerHeadroomW}W 여유` : undefined },
    { label: "GPU 장착 여유", weight: 7, applicable: metrics.gpuClearanceMm !== undefined || metrics.gpuLengthMm !== undefined || metrics.maxGpuLengthMm !== undefined, headroom: metrics.gpuClearanceMm, capacity: metrics.maxGpuLengthMm, detail: metrics.gpuClearanceMm !== undefined ? `${metrics.gpuLengthMm ?? "?"}mm GPU · ${metrics.gpuClearanceMm}mm 여유` : undefined },
    { label: "PSU 장착 여유", weight: 3, applicable: metrics.psuClearanceMm !== undefined || metrics.psuDepthMm !== undefined || metrics.maxPsuLengthMm !== undefined, headroom: metrics.psuClearanceMm, capacity: metrics.maxPsuLengthMm, detail: metrics.psuClearanceMm !== undefined ? `${metrics.psuDepthMm ?? "?"}mm PSU · ${metrics.psuClearanceMm}mm 여유` : undefined },
    { label: "쿨러 장착 여유", weight: 2, applicable: metrics.coolerClearanceMm !== undefined || metrics.coolerHeightMm !== undefined || metrics.maxCoolerHeightMm !== undefined, headroom: metrics.coolerClearanceMm, capacity: metrics.maxCoolerHeightMm, detail: metrics.coolerClearanceMm !== undefined ? `${metrics.coolerHeightMm ?? "?"}mm 쿨러 · ${metrics.coolerClearanceMm}mm 여유` : undefined }
  ];
  const applicableDimensions = dimensions.filter((dimension) => dimension.applicable);
  const scoredDimensions = applicableDimensions.flatMap((dimension) => {
    const score = expansionDimensionScoreFor(dimension);
    return score === undefined ? [] : [{ dimension, score }];
  });
  const knownDimensionCount = scoredDimensions.length;
  const totalDimensionCount = applicableDimensions.length;
  const details = scoredDimensions.map(({ dimension, score }) => expansionDimensionDetailFor(dimension, score));
  if (knownDimensionCount < 3) return { knownDimensionCount, totalDimensionCount, level: "unavailable", summary: `확장성 데이터 부족 · ${knownDimensionCount}/${totalDimensionCount}개 지표 확인`, details };
  const weightTotal = scoredDimensions.reduce((total, { dimension }) => total + dimension.weight, 0);
  const score = weightTotal > 0
    ? Math.round(scoredDimensions.reduce((total, { dimension, score: dimensionScore }) => total + dimensionScore * dimension.weight, 0) / weightTotal)
    : undefined;
  const level = knownDimensionCount === totalDimensionCount ? "complete" : "limited";
  return { score, knownDimensionCount, totalDimensionCount, level, summary: `확장성 ${score ?? "-"}점 · ${knownDimensionCount}/${totalDimensionCount}개 여유 지표 확인`, details };
}

export function savedBuildComparisonRankingsFor(entries: SavedBuildComparisonEntry[], kind: SavedBuildComparisonDecisionKind): SavedBuildComparisonRanking[] {
  if (entries.length === 0) return [];

  if (kind === "compatibility") {
    return [...entries]
      .sort((left, right) =>
        savedBuildComparisonRiskScoreFor(left.result) - savedBuildComparisonRiskScoreFor(right.result)
        || statusRank[left.result.status] - statusRank[right.result.status]
        || left.name.localeCompare(right.name)
      )
      .map((entry, index) => ({ entry, rank: index + 1, metric: savedBuildComparisonRiskScoreFor(entry.result), eligible: true }));
  }

  if (kind === "price") {
    const pricedEntries = entries.filter((entry) => entry.result.priceComplete && isKnownPrice(entry.result.totalPriceWon));
    const unpricedEntries = entries.filter((entry) => !entry.result.priceComplete || !isKnownPrice(entry.result.totalPriceWon));
    return [
      ...[...pricedEntries]
        .sort((left, right) =>
          left.result.totalPriceWon - right.result.totalPriceWon
          || savedBuildComparisonRiskScoreFor(left.result) - savedBuildComparisonRiskScoreFor(right.result)
          || left.name.localeCompare(right.name)
        )
        .map((entry, index) => ({ entry, rank: index + 1, metric: entry.result.totalPriceWon, eligible: true })),
      ...unpricedEntries.map((entry) => ({ entry, eligible: false, reason: "현재 총액 확인 필요" }))
    ];
  }

  if (kind === "expansion") {
    const expansionEntries = entries.map((entry) => ({ entry, evidence: savedBuildComparisonExpansionFor(entry.result.metrics) }));
    const scoredEntries = expansionEntries.filter(({ evidence }) => evidence.score !== undefined);
    const unscoredEntries = expansionEntries.filter(({ evidence }) => evidence.score === undefined);
    return [
      ...scoredEntries
        .sort((left, right) =>
          (right.evidence.score ?? -1) - (left.evidence.score ?? -1)
          || savedBuildComparisonRiskScoreFor(left.entry.result) - savedBuildComparisonRiskScoreFor(right.entry.result)
          || left.entry.name.localeCompare(right.entry.name)
        )
        .map(({ entry, evidence }, index) => ({ entry, rank: index + 1, metric: evidence.score, eligible: true })),
      ...unscoredEntries.map(({ entry, evidence }) => ({ entry, eligible: false, reason: evidence.summary }))
    ];
  }

  const scoredEntries = entries.filter((entry) => entry.result.analysis?.overallScore !== undefined && Number.isFinite(entry.result.analysis.overallScore));
  const unscoredEntries = entries.filter((entry) => entry.result.analysis?.overallScore === undefined || !Number.isFinite(entry.result.analysis.overallScore));
  return [
    ...[...scoredEntries]
      .sort((left, right) =>
        (right.result.analysis?.overallScore ?? -1) - (left.result.analysis?.overallScore ?? -1)
        || savedBuildComparisonRiskScoreFor(left.result) - savedBuildComparisonRiskScoreFor(right.result)
        || left.name.localeCompare(right.name)
      )
      .map((entry, index) => ({ entry, rank: index + 1, metric: entry.result.analysis?.overallScore ?? 0, eligible: true })),
    ...unscoredEntries.map((entry) => ({ entry, eligible: false, reason: "상대 분석 점수 확인 필요" }))
  ];
}

export function savedBuildComparisonDecisionFor(entries: SavedBuildComparisonEntry[], kind: SavedBuildComparisonDecisionKind): SavedBuildComparisonDecision | undefined {
  const winner = savedBuildComparisonRankingsFor(entries, kind).find((ranking) => ranking.eligible);
  return winner?.metric === undefined ? undefined : { kind, entry: winner.entry, metric: winner.metric };
}
