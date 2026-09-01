import { describe, expect, it } from "vitest";
import { rateLimitDecision, type RateLimitBucket } from "./rate-limit";

const policy = { limit: 2, windowMs: 10_000 };

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
});
