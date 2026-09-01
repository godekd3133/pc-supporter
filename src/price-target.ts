export interface PriceTargetHistorySummary {
  sampleCount: number;
  minPriceWon?: number;
}

export function recommendedTargetPriceFromHistory(summary: PriceTargetHistorySummary) {
  if (!Number.isInteger(summary.sampleCount) || summary.sampleCount < 2) return undefined;
  if (typeof summary.minPriceWon !== "number" || !Number.isFinite(summary.minPriceWon) || summary.minPriceWon <= 0) return undefined;
  return summary.minPriceWon;
}
