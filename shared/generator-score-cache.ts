export function scoreCachedByIdentity<T extends object>(cache: Map<T, number>, key: T, compute: () => number): number {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const score = compute();
  cache.set(key, score);
  return score;
}
