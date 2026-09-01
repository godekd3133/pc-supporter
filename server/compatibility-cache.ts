import { createHash } from "node:crypto";
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import type { BuildSelection, CompatibilityResult, RecommendationPreferences } from "../shared/types";

export type CompatibilityCacheLookup = "HIT" | "MISS" | "COALESCED";

export interface CompatibilityCacheResult<T> {
  value: T;
  lookup: CompatibilityCacheLookup;
  storedAt?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: string;
}

export interface CompatibilityCacheStats {
  size: number;
  inFlight: number;
  hits: number;
  misses: number;
  coalesced: number;
  evictions: number;
}

export interface CompatibilityResponseCacheValue {
  result: CompatibilityResult;
  body: string;
}

export class TtlLruInFlightCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private hitCount = 0;
  private missCount = 0;
  private coalescedCount = 0;
  private evictionCount = 0;

  constructor(options: { ttlMs: number; maxEntries: number }) {
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs));
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
  }

  async getOrCompute(key: string, compute: () => T | Promise<T>, now = Date.now()): Promise<CompatibilityCacheResult<T>> {
    this.prune(now);
    const cached = this.entries.get(key);
    if (cached) {
      this.hitCount += 1;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { value: cached.value, lookup: "HIT", storedAt: cached.storedAt };
    }

    const running = this.inFlight.get(key);
    if (running) {
      this.coalescedCount += 1;
      return { value: await running, lookup: "COALESCED" };
    }

    this.missCount += 1;
    const job = Promise.resolve().then(compute);
    this.inFlight.set(key, job);
    try {
      const value = await job;
      const storedAt = new Date().toISOString();
      this.set(key, { value, expiresAt: now + this.ttlMs, storedAt });
      return { value, lookup: "MISS", storedAt };
    } finally {
      if (this.inFlight.get(key) === job) this.inFlight.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }

  stats(): CompatibilityCacheStats {
    this.prune(Date.now());
    return { size: this.entries.size, inFlight: this.inFlight.size, hits: this.hitCount, misses: this.missCount, coalesced: this.coalescedCount, evictions: this.evictionCount };
  }

  private set(key: string, entry: CacheEntry<T>) {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictionCount += 1;
    }
    this.entries.set(key, entry);
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export class InFlightDeduper<T> {
  private readonly jobs = new Map<string, Promise<T>>();

  async getOrCompute(key: string, compute: () => T | Promise<T>): Promise<{ value: T; lookup: "MISS" | "COALESCED" }> {
    const existing = this.jobs.get(key);
    if (existing) return { value: await existing, lookup: "COALESCED" };
    const job = Promise.resolve().then(compute);
    this.jobs.set(key, job);
    try {
      return { value: await job, lookup: "MISS" };
    } finally {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    }
  }

  size() {
    return this.jobs.size;
  }
}

export function compatibilityRequestKey(build: BuildSelection, recommendationPreferences: RecommendationPreferences, engineVersion: string) {
  const payload = JSON.stringify({ version: 1, engineVersion, input: buildCompatibilityInputFingerprint(build, recommendationPreferences) });
  return `compatibility-request:${createHash("sha256").update(payload).digest("hex")}`;
}

export function compatibilityResultCacheKey(args: { build: BuildSelection; recommendationPreferences: RecommendationPreferences; catalogSnapshotAt: string; accessoryUpdatedAt: string; catalogRevision: number; engineVersion: string }) {
  const payload = JSON.stringify({
    version: 1,
    engineVersion: args.engineVersion,
    catalogSnapshotAt: args.catalogSnapshotAt,
    accessoryUpdatedAt: args.accessoryUpdatedAt,
    catalogRevision: args.catalogRevision,
    input: buildCompatibilityInputFingerprint(args.build, args.recommendationPreferences)
  });
  return `compatibility:${createHash("sha256").update(payload).digest("hex")}`;
}

export const compatibilityResultCache = new TtlLruInFlightCache<CompatibilityResponseCacheValue>({ ttlMs: 5 * 60 * 1000, maxEntries: 40 });
