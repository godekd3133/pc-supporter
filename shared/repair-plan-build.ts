import type { BuildSelection, PartCategory, RecommendationPlan } from "./types";

function selectionListFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function replacePartFor(build: BuildSelection, category: PartCategory, partId: string, quantityOverride?: number) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const current = selectionListFor(build, category);
    return {
      ...build,
      [category]: [{ partId, quantity: quantityOverride ?? current[0]?.quantity ?? 1 }],
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: { partId, quantity: build[category]?.quantity ?? 1 },
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {})
  } as BuildSelection;
}

function updateQuantityFor(build: BuildSelection, category: PartCategory, quantity: number) {
  const nextQuantity = Math.max(1, Math.min(99, Math.floor(quantity || 1)));
  if (category === "memory" || category === "ssd" || category === "hdd") {
    return {
      ...build,
      [category]: selectionListFor(build, category).map((selection, index) => index === 0 ? { ...selection, quantity: nextQuantity } : selection),
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  const selection = selectionListFor(build, category)[0];
  return selection ? { ...build, [category]: { ...selection, quantity: nextQuantity } } as BuildSelection : build;
}

export function repairPlanBuildFor(build: BuildSelection, plan: RecommendationPlan) {
  return plan.changes.reduce(
    (current, change) => change.kind === "change_quantity" && change.toQuantity !== undefined
      ? updateQuantityFor(current, change.category, change.toQuantity)
      : replacePartFor(current, change.category, change.toPart.id, change.toQuantity),
    build
  );
}
