import { describe, expect, it, vi } from "vitest";
import { scoreCachedByIdentity } from "./generator-score-cache";

describe("generator score cache", () => {
  it("computes an expensive score once for each candidate identity", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const cache = new Map<object, number>();
    const compute = vi.fn((candidate: { id: string }) => candidate.id === "first" ? 14 : 7);

    expect(scoreCachedByIdentity(cache, first, () => compute(first))).toBe(14);
    expect(scoreCachedByIdentity(cache, first, () => compute(first))).toBe(14);
    expect(scoreCachedByIdentity(cache, second, () => compute(second))).toBe(7);
    expect(scoreCachedByIdentity(cache, second, () => compute(second))).toBe(7);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("caches a zero score instead of recomputing it", () => {
    const candidate = { id: "zero" };
    const cache = new Map<object, number>();
    const compute = vi.fn(() => 0);

    expect(scoreCachedByIdentity(cache, candidate, compute)).toBe(0);
    expect(scoreCachedByIdentity(cache, candidate, compute)).toBe(0);
    expect(compute).toHaveBeenCalledOnce();
  });
});
