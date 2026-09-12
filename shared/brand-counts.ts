import type { BrandCountOption } from "./types";

type Branded = { brand?: string };

function normalizedBrand(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

/** Builds stable manufacturer suggestions without exposing raw catalog rows. */
export function brandCountsFor<T extends Branded>(items: ReadonlyArray<T>, limit = 80): BrandCountOption[] {
  const buckets = new Map<string, BrandCountOption>();
  for (const item of items) {
    const brand = item.brand?.trim();
    if (!brand) continue;
    const key = normalizedBrand(brand);
    const current = buckets.get(key);
    if (current) current.count += 1;
    else buckets.set(key, { brand, count: 1 });
  }
  return [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.brand.localeCompare(right.brand, "ko-KR"))
    .slice(0, Math.max(1, Math.floor(limit)));
}
