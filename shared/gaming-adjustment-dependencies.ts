import type { PartCategory } from "./types";

export function gamingAdjustmentDependentCategories(category: PartCategory): PartCategory[] {
  const edges: Partial<Record<PartCategory, PartCategory[]>> = {
    cpu: ["motherboard", "memory", "cooler", "psu", "case"], gpu: ["psu", "case"],
    motherboard: ["cpu", "memory", "cooler", "case"], memory: ["motherboard"], cooler: ["case"], case: ["cooler"], psu: ["case"], hdd: ["case"]
  };
  const categories = new Set<PartCategory>();
  const visit = (key: PartCategory) => {
    if (categories.has(key)) return;
    categories.add(key);
    for (const next of edges[key] ?? []) visit(next);
  };
  visit(category);
  return [...categories];
}
