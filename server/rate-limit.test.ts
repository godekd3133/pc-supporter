import { describe, expect, it } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import { createRateLimitMiddleware, pruneBuckets, rateLimitDecision, type RateLimitBucket } from "./rate-limit";

const policy = { limit: 2, windowMs: 10_000 };

function responseRecorder() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  const response = {
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); return response; },
    status(value: number) { statusCode = value; return response; },
    json(value: unknown) { body = value; return response; }
  };
  return { response: response as unknown as Response, headers, status: () => statusCode, body: () => body };
}

async function runMiddleware(middleware: RequestHandler, address: string) {
  const recorded = responseRecorder();
  let continued = false;
  await middleware(
    { ip: address, socket: { remoteAddress: address } } as unknown as Request,
    recorded.response,
    (() => { continued = true; }) as never
  );
  return { ...recorded, continued };
}

describe("rate limit decision", () => {
  it("allows up to the limit and reports remaining capacity", () => {
    const buckets = new Map<string, RateLimitBucket>();
    expect(rateLimitDecision(buckets, "client-a", policy, 1_000)).toMatchObject({ allowed: true, remaining: 1, retryAfterSeconds: 10 });
    expect(rateLimitDecision(buckets, "client-a", policy, 2_000)).toMatchObject({ allowed: true, remaining: 0, retryAfterSeconds: 9 });
    expect(rateLimitDecision(buckets, "client-a", policy, 3_000)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 8 });
  });

  it("starts a fresh window at the exact boundary", () => {
    const buckets = new Map<string, RateLimitBucket>();
    rateLimitDecision(buckets, "client-a", policy, 1_000);
    rateLimitDecision(buckets, "client-a", policy, 2_000);
    expect(rateLimitDecision(buckets, "client-a", policy, 11_000)).toMatchObject({ allowed: true, remaining: 1, resetAt: 21_000 });
  });

  it("isolates clients by key", () => {
    const buckets = new Map<string, RateLimitBucket>();
    rateLimitDecision(buckets, "client-a", { limit: 1, windowMs: 10_000 }, 1_000);
    expect(rateLimitDecision(buckets, "client-a", { limit: 1, windowMs: 10_000 }, 2_000).allowed).toBe(false);
    expect(rateLimitDecision(buckets, "client-b", { limit: 1, windowMs: 10_000 }, 2_000).allowed).toBe(true);
  });

  it("clamps malformed policies to safe minimums", () => {
    const buckets = new Map<string, RateLimitBucket>();
    expect(rateLimitDecision(buckets, "client-a", { limit: 0, windowMs: 0 }, 1_000)).toMatchObject({ allowed: true, limit: 1, resetAt: 2_000, retryAfterSeconds: 1 });
  });

  it("bounds active buckets when unique clients exceed the memory cap", () => {
    const buckets = new Map<string, RateLimitBucket>([
      ["oldest", { startedAt: 1_000, count: 1 }],
      ["middle", { startedAt: 2_000, count: 1 }],
      ["newest", { startedAt: 3_000, count: 1 }]
    ]);

    pruneBuckets(buckets, { limit: 2, windowMs: 10_000 }, 4_000, 2);

    expect(buckets.size).toBe(2);
    expect([...buckets.keys()]).toEqual(["middle", "newest"]);
  });

  it("evicts by last activity instead of window start time", () => {
    const buckets = new Map<string, RateLimitBucket>([
      ["quiet-old-window", { startedAt: 1_000, count: 1, lastSeenAt: 1_000 }],
      ["recent-old-window", { startedAt: 1_000, count: 2, lastSeenAt: 3_900 }],
      ["new-window", { startedAt: 3_500, count: 1, lastSeenAt: 3_500 }]
    ]);

    pruneBuckets(buckets, { limit: 2, windowMs: 10_000 }, 4_000, 2);

    expect([...buckets.keys()]).toEqual(["recent-old-window", "new-window"]);
  });

  it("uses a shared asynchronous store across middleware instances", async () => {
    const sharedBuckets = new Map<string, RateLimitBucket>();
    const store = {
      consume: async (scope: string, address: string, currentPolicy: typeof policy, now: number) =>
        rateLimitDecision(sharedBuckets, `${scope}:${address}`, currentPolicy, now)
    };
    const firstReplica = createRateLimitMiddleware("public-read", policy, store);
    const secondReplica = createRateLimitMiddleware("public-read", policy, store);

    expect((await runMiddleware(firstReplica, "198.51.100.10")).continued).toBe(true);
    expect((await runMiddleware(secondReplica, "198.51.100.10")).continued).toBe(true);
    const limited = await runMiddleware(firstReplica, "198.51.100.10");

    expect(limited.continued).toBe(false);
    expect(limited.status()).toBe(429);
    expect(limited.body()).toMatchObject({ code: "RATE_LIMITED" });
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("fails closed with 503 when the shared store is unavailable", async () => {
    const middleware = createRateLimitMiddleware("public-read", policy, { consume: async () => { throw new Error("database unavailable"); } });
    const result = await runMiddleware(middleware, "198.51.100.11");

    expect(result.continued).toBe(false);
    expect(result.status()).toBe(503);
    expect(result.headers.get("retry-after")).toBe("1");
    expect(result.body()).toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
  });
});
