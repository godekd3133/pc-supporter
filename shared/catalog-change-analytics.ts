import { isKnownPrice } from "./types";
import type { CatalogChangeRecord } from "./types";

export interface CatalogChangeTrendPoint {
  date: string;
  priceChangeCount: number;
  priceUpCount: number;
  priceDownCount: number;
  priceUpWon: number;
  priceDownWon: number;
  netDeltaWon: number;
}

export interface CatalogChangeTrend {
  points: CatalogChangeTrendPoint[];
  priceChangeCount: number;
  priceUpCount: number;
  priceDownCount: number;
  priceUpWon: number;
  priceDownWon: number;
  netDeltaWon: number;
}

export interface CatalogChangePriceHistoryPoint {
  changeId: string;
  changedAt: string;
  priceWon: number;
  deltaWon?: number;
}

export interface CatalogChangePriceHistorySummary {
  sampleCount: number;
  firstPriceWon?: number;
  latestPriceWon?: number;
  minPriceWon?: number;
  maxPriceWon?: number;
  netDeltaWon?: number;
  netChangePercent?: number;
  fromHighDeltaWon?: number;
  fromHighPercent?: number;
}

export interface CatalogChangePriceWindowSummary extends CatalogChangePriceHistorySummary {
  windowDays: number;
  currentPositionPercent?: number;
  rangeWon?: number;
  rangePercent?: number;
  hasDropThenRebound: boolean;
}

export interface CatalogChangePriceOpportunity {
  itemId: string;
  itemName: string;
  category: CatalogChangeRecord["category"];
  latestChangeId: string;
  windowDays: number;
  sampleCount: number;
  latestPriceWon: number;
  minPriceWon: number;
  maxPriceWon: number;
  fromHighDeltaWon: number;
  fromHighPercent: number;
  currentPositionPercent?: number;
  rangeWon: number;
  rangePercent?: number;
  hasDropThenRebound: boolean;
  firstChangedAt: string;
  latestChangedAt: string;
}

export type CatalogChangePriceWatchSignal = "near_low" | "below_high" | "rebound" | "target_reached";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function timestampFor(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function catalogChangeKstDateFor(changedAt: string) {
  const timestamp = timestampFor(changedAt);
  return timestamp === undefined ? undefined : new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function priceDeltaFor(record: CatalogChangeRecord) {
  if (typeof record.priceDeltaWon === "number" && Number.isFinite(record.priceDeltaWon)) return record.priceDeltaWon;
  if (record.previousPriceWon !== undefined && record.nextPriceWon !== undefined && Number.isFinite(record.previousPriceWon) && Number.isFinite(record.nextPriceWon)) {
    return record.nextPriceWon - record.previousPriceWon;
  }
  return undefined;
}

function normalizedWindowDays(value: number | undefined) {
  return Math.min(365, Math.max(1, Math.floor(value ?? 30)));
}

export function catalogChangePriceHistoryFor(records: CatalogChangeRecord[]): CatalogChangePriceHistoryPoint[] {
  return records
    .map((record) => ({
      record,
      priceWon: record.nextPriceWon,
      timestamp: timestampFor(record.changedAt)
    }))
    .filter((item): item is { record: CatalogChangeRecord; priceWon: number; timestamp: number } => isKnownPrice(item.priceWon) && item.timestamp !== undefined)
    .map(({ record, priceWon }) => {
      const deltaWon = priceDeltaFor(record);
      return {
        changeId: record.id,
        changedAt: record.changedAt,
        priceWon,
        ...(deltaWon !== undefined ? { deltaWon } : {})
      };
    })
    .sort((left, right) => Date.parse(left.changedAt) - Date.parse(right.changedAt) || left.changeId.localeCompare(right.changeId));
}

export function catalogChangePriceHistoryWithinWindowFor(points: CatalogChangePriceHistoryPoint[], options: { days?: number; anchor?: string } = {}) {
  if (points.length === 0) return [];
  const days = normalizedWindowDays(options.days);
  const timestamps = points.map((point) => timestampFor(point.changedAt)).filter((timestamp): timestamp is number => timestamp !== undefined);
  const anchorTimestamp = timestampFor(options.anchor ?? "") ?? Math.max(...timestamps);
  const cutoffTimestamp = anchorTimestamp - days * DAY_MS;
  return points
    .filter((point) => {
      const timestamp = timestampFor(point.changedAt);
      return timestamp !== undefined && timestamp >= cutoffTimestamp && timestamp <= anchorTimestamp;
    })
    .sort((left, right) => Date.parse(left.changedAt) - Date.parse(right.changedAt) || left.changeId.localeCompare(right.changeId));
}

export function catalogChangePriceHistorySummaryFor(points: CatalogChangePriceHistoryPoint[]): CatalogChangePriceHistorySummary {
  if (points.length === 0) return { sampleCount: 0 };
  const firstPriceWon = points[0].priceWon;
  const latestPriceWon = points[points.length - 1].priceWon;
  const minPriceWon = Math.min(...points.map((point) => point.priceWon));
  const maxPriceWon = Math.max(...points.map((point) => point.priceWon));
  const netDeltaWon = latestPriceWon - firstPriceWon;
  const fromHighDeltaWon = latestPriceWon - maxPriceWon;
  return {
    sampleCount: points.length,
    firstPriceWon,
    latestPriceWon,
    minPriceWon,
    maxPriceWon,
    netDeltaWon,
    netChangePercent: (netDeltaWon / firstPriceWon) * 100,
    fromHighDeltaWon,
    fromHighPercent: (fromHighDeltaWon / maxPriceWon) * 100
  };
}

export function catalogChangePriceWindowSummaryFor(points: CatalogChangePriceHistoryPoint[], options: { days?: number; anchor?: string } = {}): CatalogChangePriceWindowSummary {
  const windowDays = normalizedWindowDays(options.days);
  const windowPoints = catalogChangePriceHistoryWithinWindowFor(points, { days: windowDays, anchor: options.anchor });
  const summary = catalogChangePriceHistorySummaryFor(windowPoints);
  if (windowPoints.length === 0) return { ...summary, windowDays, hasDropThenRebound: false };
  const rangeWon = summary.maxPriceWon !== undefined && summary.minPriceWon !== undefined ? summary.maxPriceWon - summary.minPriceWon : undefined;
  const currentPositionPercent = rangeWon !== undefined && rangeWon > 0 && summary.latestPriceWon !== undefined && summary.minPriceWon !== undefined ? ((summary.latestPriceWon - summary.minPriceWon) / rangeWon) * 100 : undefined;
  let sawDrop = false;
  let hasDropThenRebound = false;
  for (let index = 1; index < windowPoints.length; index += 1) {
    const delta = windowPoints[index].priceWon - windowPoints[index - 1].priceWon;
    if (delta < 0) sawDrop = true;
    if (sawDrop && delta > 0) hasDropThenRebound = true;
  }
  return {
    ...summary,
    windowDays,
    currentPositionPercent,
    rangeWon,
    rangePercent: summary.minPriceWon !== undefined && summary.minPriceWon > 0 && rangeWon !== undefined ? (rangeWon / summary.minPriceWon) * 100 : undefined,
    hasDropThenRebound
  };
}

export function catalogChangePriceWatchSignalsFor(summary: CatalogChangePriceWindowSummary, nearLowThresholdPercent = 10, targetPriceWon?: number): CatalogChangePriceWatchSignal[] {
  const threshold = Number.isFinite(nearLowThresholdPercent) ? Math.min(100, Math.max(0, nearLowThresholdPercent)) : 10;
  const signals: CatalogChangePriceWatchSignal[] = [];
  if (summary.sampleCount >= 2) {
    if (summary.currentPositionPercent !== undefined && summary.currentPositionPercent <= threshold) signals.push("near_low");
    if (summary.fromHighPercent !== undefined && summary.fromHighPercent < 0) signals.push("below_high");
    if (summary.hasDropThenRebound) signals.push("rebound");
  }
  if (targetPriceWon !== undefined && isKnownPrice(targetPriceWon) && summary.latestPriceWon !== undefined && summary.latestPriceWon <= targetPriceWon) signals.push("target_reached");
  return signals;
}

function catalogChangePriceRankingCandidatesFor(records: CatalogChangeRecord[]): CatalogChangePriceOpportunity[] {
  const recordsByItem = new Map<string, CatalogChangeRecord[]>();
  for (const record of records) recordsByItem.set(record.itemId, [...(recordsByItem.get(record.itemId) ?? []), record]);
  const opportunities: CatalogChangePriceOpportunity[] = [];
  for (const itemRecords of recordsByItem.values()) {
    const history = catalogChangePriceHistoryFor(itemRecords);
    const windowHistory = catalogChangePriceHistoryWithinWindowFor(history, { days: 30 });
    const summary = catalogChangePriceWindowSummaryFor(history, { days: 30 });
    if (windowHistory.length < 2 || summary.latestPriceWon === undefined || summary.minPriceWon === undefined || summary.maxPriceWon === undefined || summary.fromHighDeltaWon === undefined || summary.fromHighPercent === undefined || summary.currentPositionPercent === undefined || summary.rangeWon === undefined || summary.rangeWon <= 0) continue;
    const latestRecord = itemRecords.slice().sort((left, right) => right.changedAt.localeCompare(left.changedAt) || right.id.localeCompare(left.id))[0];
    opportunities.push({
      itemId: latestRecord.itemId,
      itemName: latestRecord.itemName,
      category: latestRecord.category,
      latestChangeId: windowHistory[windowHistory.length - 1].changeId,
      windowDays: summary.windowDays,
      sampleCount: windowHistory.length,
      latestPriceWon: summary.latestPriceWon,
      minPriceWon: summary.minPriceWon,
      maxPriceWon: summary.maxPriceWon,
      fromHighDeltaWon: summary.fromHighDeltaWon,
      fromHighPercent: summary.fromHighPercent,
      ...(summary.currentPositionPercent !== undefined ? { currentPositionPercent: summary.currentPositionPercent } : {}),
      rangeWon: summary.rangeWon ?? 0,
      ...(summary.rangePercent !== undefined ? { rangePercent: summary.rangePercent } : {}),
      hasDropThenRebound: summary.hasDropThenRebound,
      firstChangedAt: windowHistory[0].changedAt,
      latestChangedAt: windowHistory[windowHistory.length - 1].changedAt
    });
  }
  return opportunities;
}

function catalogChangePriceRankingLimit(limit: number) {
  return Math.min(12, Math.max(1, Math.floor(limit)));
}

export function catalogChangePriceOpportunitiesFor(records: CatalogChangeRecord[], limit = 6): CatalogChangePriceOpportunity[] {
  return catalogChangePriceRankingCandidatesFor(records)
    .filter((item) => item.fromHighDeltaWon < 0)
    .sort((left, right) => left.fromHighPercent - right.fromHighPercent || left.fromHighDeltaWon - right.fromHighDeltaWon || right.latestChangedAt.localeCompare(left.latestChangedAt) || left.itemName.localeCompare(right.itemName))
    .slice(0, catalogChangePriceRankingLimit(limit));
}

export function catalogChangePriceVolatilityRankingsFor(records: CatalogChangeRecord[], limit = 6): CatalogChangePriceOpportunity[] {
  return catalogChangePriceRankingCandidatesFor(records)
    .sort((left, right) => (right.rangePercent ?? 0) - (left.rangePercent ?? 0) || right.rangeWon - left.rangeWon || right.latestChangedAt.localeCompare(left.latestChangedAt) || left.itemName.localeCompare(right.itemName))
    .slice(0, catalogChangePriceRankingLimit(limit));
}

export function catalogChangePriceNearLowRankingsFor(records: CatalogChangeRecord[], limit = 6): CatalogChangePriceOpportunity[] {
  return catalogChangePriceRankingCandidatesFor(records)
    .sort((left, right) => (left.currentPositionPercent ?? 100) - (right.currentPositionPercent ?? 100) || left.fromHighPercent - right.fromHighPercent || right.latestChangedAt.localeCompare(left.latestChangedAt) || left.itemName.localeCompare(right.itemName))
    .slice(0, catalogChangePriceRankingLimit(limit));
}

function trendPoint(date: string): CatalogChangeTrendPoint {
  return { date, priceChangeCount: 0, priceUpCount: 0, priceDownCount: 0, priceUpWon: 0, priceDownWon: 0, netDeltaWon: 0 };
}

export function catalogChangeTrendFor(records: CatalogChangeRecord[], options: { days?: number; anchor?: string } = {}): CatalogChangeTrend {
  const days = Math.min(31, Math.max(1, Math.floor(options.days ?? 7)));
  const recordTimestamps = records.map((record) => timestampFor(record.changedAt)).filter((timestamp): timestamp is number => timestamp !== undefined);
  const anchorTimestamp = timestampFor(options.anchor ?? "") ?? (recordTimestamps.length > 0 ? Math.max(...recordTimestamps) : Date.now());
  const anchorDate = catalogChangeKstDateFor(new Date(anchorTimestamp).toISOString()) ?? new Date(anchorTimestamp).toISOString().slice(0, 10);
  const anchorDayTimestamp = Date.parse(`${anchorDate}T00:00:00.000Z`);
  const points = Array.from({ length: days }, (_, index) => trendPoint(new Date(anchorDayTimestamp - (days - index - 1) * DAY_MS).toISOString().slice(0, 10)));
  const pointsByDate = new Map(points.map((point) => [point.date, point]));

  for (const record of records) {
    const date = catalogChangeKstDateFor(record.changedAt);
    const delta = priceDeltaFor(record);
    const point = date ? pointsByDate.get(date) : undefined;
    if (!point || delta === undefined || delta === 0) continue;
    point.priceChangeCount += 1;
    point.netDeltaWon += delta;
    if (delta > 0) {
      point.priceUpCount += 1;
      point.priceUpWon += delta;
    } else {
      point.priceDownCount += 1;
      point.priceDownWon += Math.abs(delta);
    }
  }

  return points.reduce<CatalogChangeTrend>((trend, point) => ({
    points: [...trend.points, point],
    priceChangeCount: trend.priceChangeCount + point.priceChangeCount,
    priceUpCount: trend.priceUpCount + point.priceUpCount,
    priceDownCount: trend.priceDownCount + point.priceDownCount,
    priceUpWon: trend.priceUpWon + point.priceUpWon,
    priceDownWon: trend.priceDownWon + point.priceDownWon,
    netDeltaWon: trend.netDeltaWon + point.netDeltaWon
  }), { points: [], priceChangeCount: 0, priceUpCount: 0, priceDownCount: 0, priceUpWon: 0, priceDownWon: 0, netDeltaWon: 0 });
}
