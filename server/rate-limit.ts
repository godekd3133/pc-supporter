import type { RequestHandler } from "express";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitBucket {
  startedAt: number;
  count: number;
  lastSeenAt?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(scope: string, address: string, policy: RateLimitPolicy, now: number): Promise<RateLimitDecision | undefined>;
}

export class RateLimitStoreUnavailableError extends Error {
  constructor(readonly code: "PERSISTENCE_UNAVAILABLE" | "RATE_LIMIT_KEY_UNCONFIGURED") {
    super(code === "PERSISTENCE_UNAVAILABLE" ? "Rate-limit persistence is unavailable." : "Shared rate limiting is not configured.");
    this.name = "RateLimitStoreUnavailableError";
  }
}

export function rateLimitDecision(buckets: Map<string, RateLimitBucket>, key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitDecision {
  const limit = Math.max(1, Math.floor(policy.limit));
  const windowMs = Math.max(1_000, Math.floor(policy.windowMs));
  const current = buckets.get(key);
  const bucket = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  bucket.lastSeenAt = now;
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

export function pruneBuckets(buckets: Map<string, RateLimitBucket>, policy: RateLimitPolicy, now: number, maxEntries = 10_000) {
  const boundedMaxEntries = Math.max(1, Math.floor(maxEntries));
  if (buckets.size <= boundedMaxEntries) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= policy.windowMs) buckets.delete(key);
    if (buckets.size <= boundedMaxEntries) return;
  }
  if (buckets.size <= boundedMaxEntries) return;
  const overflow = buckets.size - boundedMaxEntries;
  const oldestActiveKeys = [...buckets.entries()]
    .sort(([, left], [, right]) => (left.lastSeenAt ?? left.startedAt) - (right.lastSeenAt ?? right.startedAt))
    .slice(0, overflow)
    .map(([key]) => key);
  oldestActiveKeys.forEach((key) => buckets.delete(key));
}

export function createRateLimitMiddleware(name: string, policy: RateLimitPolicy, store?: RateLimitStore, maxEntries = 10_000): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();
  return async (request, response, next) => {
    const now = Date.now();
    const address = request.ip || request.socket.remoteAddress || "unknown";
    try {
      const storedDecision = await store?.consume(name, address, policy, now);
      let decision = storedDecision;
      if (!decision) {
        pruneBuckets(buckets, policy, now, maxEntries);
        decision = rateLimitDecision(buckets, `${name}:${address}`, policy, now);
      }
      response.setHeader("X-RateLimit-Limit", String(decision.limit));
      response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
      response.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
      if (!decision.allowed) {
        response.setHeader("Retry-After", String(decision.retryAfterSeconds));
        response.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds });
        return;
      }
      next();
    } catch (error: unknown) {
      response.setHeader("Retry-After", "1");
      const code = error instanceof RateLimitStoreUnavailableError ? error.code : "RATE_LIMIT_UNAVAILABLE";
      const message = code === "PERSISTENCE_UNAVAILABLE"
        ? "저장소에 연결할 수 없어 요청을 처리하지 못했습니다."
        : code === "RATE_LIMIT_KEY_UNCONFIGURED"
          ? "공유 요청 제한 설정이 없어 요청을 처리하지 못했습니다."
          : "요청 제한 저장소에 연결할 수 없어 요청을 처리하지 못했습니다.";
      response.status(503).json({ error: message, code, retryAfterSeconds: 1 });
    }
  };
}
