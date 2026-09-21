const DAY_MS = 24 * 60 * 60 * 1000;

export type PriceTrendWindow = 7 | 30 | 90;

export interface PriceTrendHistoryPoint {
  changedAt: string;
  priceWon: number;
}

export interface PriceTrendItemInput {
  key: string;
  label: string;
  quantity: number;
  currentPriceWon?: number;
  points: PriceTrendHistoryPoint[];
}

export interface PriceTrendPoint {
  at: string;
  priceWon: number;
}

export interface PriceTrendDriver {
  key: string;
  label: string;
  deltaWon: number;
}

export interface PriceTrendResult {
  points: PriceTrendPoint[];
  drivers: PriceTrendDriver[];
  sampleCount: number;
  historicalSampleCount: number;
  coveredItemCount: number;
  totalItemCount: number;
  latestPriceWon?: number;
  minPriceWon?: number;
  maxPriceWon?: number;
  netDeltaWon?: number;
}

function validTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function validPrice(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizedWindow(value: PriceTrendWindow | undefined): PriceTrendWindow {
  return value === 7 || value === 90 ? value : 30;
}

function dedupeSortedTimestamps(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value)).map((value) => Math.floor(value)))].sort((left, right) => left - right);
}

function pointAtOrBefore(points: Array<{ timestamp: number; priceWon: number }>, timestamp: number) {
  let candidate: number | undefined;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    candidate = point.priceWon;
  }
  return candidate;
}

export function priceTrendFor(items: PriceTrendItemInput[], options: { days?: PriceTrendWindow; anchor?: string } = {}): PriceTrendResult {
  const days = normalizedWindow(options.days);
  const anchorTimestamp = validTimestamp(options.anchor ?? "") ?? Date.now();
  const cutoffTimestamp = anchorTimestamp - days * DAY_MS;
  const normalizedItems = items
    .map((item) => {
      const points = item.points
        .map((point) => {
          const timestamp = validTimestamp(point.changedAt);
          return timestamp !== undefined && validPrice(point.priceWon) ? { timestamp, priceWon: point.priceWon } : undefined;
        })
        .filter((point): point is { timestamp: number; priceWon: number } => point !== undefined)
        .filter((point) => point.timestamp >= cutoffTimestamp && point.timestamp <= anchorTimestamp)
        .sort((left, right) => left.timestamp - right.timestamp);
      const currentPriceWon = validPrice(item.currentPriceWon) ? item.currentPriceWon : points.at(-1)?.priceWon;
      return {
        ...item,
        quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 1,
        points,
        currentPriceWon,
        hasHistory: points.length > 0
      };
    })
    .filter((item) => validPrice(item.currentPriceWon) || item.points.length > 0);

  const timestamps = dedupeSortedTimestamps([
    ...normalizedItems.flatMap((item) => item.points.map((point) => point.timestamp)),
    anchorTimestamp
  ]);
  const chartPoints: PriceTrendPoint[] = [];
  const itemValuesAtFirst = new Map<string, number>();

  for (const timestamp of timestamps) {
    let total = 0;
    let complete = true;
    for (const item of normalizedItems) {
      const value = timestamp === anchorTimestamp && validPrice(item.currentPriceWon)
        ? item.currentPriceWon
        : pointAtOrBefore(item.points, timestamp) ?? item.currentPriceWon;
      if (!validPrice(value)) {
        complete = false;
        break;
      }
      total += value * item.quantity;
    }
    if (!complete || normalizedItems.length === 0) continue;
    const at = new Date(timestamp).toISOString();
    chartPoints.push({ at, priceWon: total });
    if (itemValuesAtFirst.size === 0) {
      for (const item of normalizedItems) {
        const value = timestamp === anchorTimestamp && validPrice(item.currentPriceWon)
          ? item.currentPriceWon
          : pointAtOrBefore(item.points, timestamp) ?? item.currentPriceWon;
        if (validPrice(value)) itemValuesAtFirst.set(item.key, value * item.quantity);
      }
    }
  }

  const latestPoint = chartPoints.at(-1);
  const firstPoint = chartPoints[0];
  const drivers = normalizedItems
    .map((item) => {
      const firstValue = itemValuesAtFirst.get(item.key);
      const latestValue = validPrice(item.currentPriceWon) ? item.currentPriceWon : pointAtOrBefore(item.points, anchorTimestamp);
      return firstValue !== undefined && validPrice(latestValue)
        ? { key: item.key, label: item.label, deltaWon: latestValue * item.quantity - firstValue }
        : undefined;
    })
    .filter((driver): driver is PriceTrendDriver => driver !== undefined)
    .filter((driver) => driver.deltaWon !== 0)
    .sort((left, right) => Math.abs(right.deltaWon) - Math.abs(left.deltaWon) || left.label.localeCompare(right.label));

  return {
    points: chartPoints,
    drivers,
    sampleCount: chartPoints.length,
    historicalSampleCount: normalizedItems.reduce((count, item) => count + item.points.length, 0),
    coveredItemCount: normalizedItems.length,
    totalItemCount: items.length,
    ...(latestPoint ? { latestPriceWon: latestPoint.priceWon } : {}),
    ...(chartPoints.length > 0 ? { minPriceWon: Math.min(...chartPoints.map((point) => point.priceWon)), maxPriceWon: Math.max(...chartPoints.map((point) => point.priceWon)) } : {}),
    ...(firstPoint && latestPoint ? { netDeltaWon: latestPoint.priceWon - firstPoint.priceWon } : {})
  };
}
