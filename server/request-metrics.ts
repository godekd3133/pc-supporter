// HTTP 요청 지표 레지스트리 — requestTelemetry가 내보내는 완료 기록을
// 라우트별로 묶어 최근 구간의 처리량·오류율·지연 분포를 유지한다.
// 로그 스트림은 그대로 두고 여기서 집계만 담당한다.
import type { HttpRequestLog } from "./request-telemetry";

const ROUTE_RESERVOIR_SIZE = 256;
const ROUTE_COUNT_LIMIT = 120;

type RouteMetrics = {
  count: number;
  errors: number;
  clientErrors: number;
  totalMs: number;
  maxMs: number;
  lastAt: number;
  durations: number[];
};

const routes = new Map<string, RouteMetrics>();
let totalCount = 0;
let totalErrors = 0;
let startedAt = Date.now();

function routeKey(record: HttpRequestLog) {
  return `${record.method} ${record.route}`;
}

export function recordHttpRequestMetric(record: HttpRequestLog) {
  if (record.outcome !== "completed") return;
  const key = routeKey(record);
  let bucket = routes.get(key);
  if (!bucket) {
    if (routes.size >= ROUTE_COUNT_LIMIT) {
      // 라우트 폭발을 막기 위해 가장 오래된 라우트를 버린다.
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [candidateKey, candidate] of routes) {
        if (candidate.lastAt < oldestAt) {
          oldestAt = candidate.lastAt;
          oldestKey = candidateKey;
        }
      }
      if (oldestKey) routes.delete(oldestKey);
    }
    bucket = { count: 0, errors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, lastAt: 0, durations: [] };
    routes.set(key, bucket);
  }
  bucket.count += 1;
  totalCount += 1;
  if (record.statusCode >= 500) {
    bucket.errors += 1;
    totalErrors += 1;
  } else if (record.statusCode >= 400) {
    bucket.clientErrors += 1;
  }
  bucket.totalMs += record.durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, record.durationMs);
  bucket.lastAt = Date.now();
  bucket.durations.push(record.durationMs);
  if (bucket.durations.length > ROUTE_RESERVOIR_SIZE) bucket.durations.splice(0, bucket.durations.length - ROUTE_RESERVOIR_SIZE);
}

function percentile(durations: number[], ratio: number) {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

export type HttpRouteMetricSummary = {
  route: string;
  count: number;
  errors: number;
  clientErrors: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastAt: number;
};

export function httpMetricsSnapshot(limit = 30) {
  const summaries: HttpRouteMetricSummary[] = [...routes.entries()].map(([route, bucket]) => ({
    route,
    count: bucket.count,
    errors: bucket.errors,
    clientErrors: bucket.clientErrors,
    avgMs: bucket.count > 0 ? Math.round((bucket.totalMs / bucket.count) * 10) / 10 : 0,
    p50Ms: percentile(bucket.durations, 0.5),
    p95Ms: percentile(bucket.durations, 0.95),
    maxMs: Math.round(bucket.maxMs * 10) / 10,
    lastAt: bucket.lastAt
  }));
  summaries.sort((a, b) => b.count - a.count);
  return {
    startedAt: new Date(startedAt).toISOString(),
    totalRequests: totalCount,
    totalErrors: totalErrors,
    routes: summaries.slice(0, Math.max(1, limit))
  };
}

export function resetHttpMetricsForTest() {
  routes.clear();
  totalCount = 0;
  totalErrors = 0;
  startedAt = Date.now();
}
