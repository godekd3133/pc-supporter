import type { RequestHandler } from "express";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitBucket {
  startedAt: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export function rateLimitDecision(buckets: Map<string, RateLimitBucket>, key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitDecision {
  const limit = Math.max(1, Math.floor(policy.limit));
  const windowMs = Math.max(1_000, Math.floor(policy.windowMs));
  const current = buckets.get(key);
  const bucket = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  const resetAt = bucket.startedAt + windowMs;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
  };
}

function pruneBuckets(buckets: Map<string, RateLimitBucket>, policy: RateLimitPolicy, now: number, maxEntries = 10_000) {
  if (buckets.size <= maxEntries) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= policy.windowMs) buckets.delete(key);
    if (buckets.size <= maxEntries) break;
  }
}

export function createRateLimitMiddleware(name: string, policy: RateLimitPolicy, maxEntries = 10_000): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();
  return (request, response, next) => {
    const now = Date.now();
    pruneBuckets(buckets, policy, now, maxEntries);
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const decision = rateLimitDecision(buckets, `${name}:${address}`, policy, now);
    response.setHeader("X-RateLimit-Limit", String(decision.limit));
    response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      response.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds });
      return;
    }
    next();
  };
}
