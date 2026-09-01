export type RefreshTarget = {
  kind: "part" | "accessory";
  id: string;
};

export function uniqueRefreshTargets(targets: RefreshTarget[], limit = 12) {
  const seen = new Set<string>();
  const normalizedLimit = Math.max(1, Math.floor(limit));
  return targets.filter((target) => {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key) || seen.size >= normalizedLimit) return false;
    seen.add(key);
    return true;
  });
}
