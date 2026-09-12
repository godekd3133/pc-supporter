import { isKnownPrice } from "./types";
import { purchaseListRowKey, type PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistorySummaryFor, type PurchaseListPriceHistory } from "./purchase-list-price-history";

export interface PurchaseListPriceHistoryOverview {
  rowCount: number;
  latestKnownRowCount: number;
  previousKnownRowCount: number;
  latestPriceComplete: boolean;
  previousPriceComplete: boolean;
  changedRowCount: number;
  minSampleCount: number;
  maxSampleCount: number;
  latestTotalPriceWon?: number;
  previousTotalPriceWon?: number;
  deltaFromPreviousTotalPriceWon?: number;
}

export function purchaseListPriceHistoryOverviewFor(rows: ReadonlyArray<PurchaseListRow>, history: PurchaseListPriceHistory): PurchaseListPriceHistoryOverview {
  let latestKnownRowCount = 0;
  let previousKnownRowCount = 0;
  let latestTotalPriceWon = 0;
  let previousTotalPriceWon = 0;
  let changedRowCount = 0;
  const sampleCounts: number[] = [];

  rows.forEach((row, index) => {
    const summary = purchaseListPriceHistorySummaryFor(history, purchaseListRowKey(row, index));
    sampleCounts.push(summary.sampleCount);
    if (isKnownPrice(summary.latestUnitPriceWon)) {
      latestKnownRowCount += 1;
      latestTotalPriceWon += summary.latestUnitPriceWon * row.quantity;
    }
    if (isKnownPrice(summary.previousUnitPriceWon)) {
      previousKnownRowCount += 1;
      previousTotalPriceWon += summary.previousUnitPriceWon * row.quantity;
    }
    if (isKnownPrice(summary.latestUnitPriceWon) && isKnownPrice(summary.previousUnitPriceWon) && summary.latestUnitPriceWon !== summary.previousUnitPriceWon) changedRowCount += 1;
  });

  const latestPriceComplete = rows.length > 0 && latestKnownRowCount === rows.length;
  const previousPriceComplete = rows.length > 0 && previousKnownRowCount === rows.length;
  const overview: PurchaseListPriceHistoryOverview = {
    rowCount: rows.length,
    latestKnownRowCount,
    previousKnownRowCount,
    latestPriceComplete,
    previousPriceComplete,
    changedRowCount,
    minSampleCount: sampleCounts.length > 0 ? Math.min(...sampleCounts) : 0,
    maxSampleCount: sampleCounts.length > 0 ? Math.max(...sampleCounts) : 0,
    ...(latestPriceComplete ? { latestTotalPriceWon } : {}),
    ...(previousPriceComplete ? { previousTotalPriceWon } : {}),
    ...(latestPriceComplete && previousPriceComplete ? { deltaFromPreviousTotalPriceWon: latestTotalPriceWon - previousTotalPriceWon } : {})
  };
  return overview;
}
