import type { BuildSelection, PartCategory, RecommendationPlan } from "./types";

export type PerformanceCategory = "cpu" | "gpu" | "memory" | "ssd" | "hdd";

export type RepairPlanPerformanceRetention = {
  status: "preserved" | "mixed" | "changed" | "unknown";
  retainedCategories: PerformanceCategory[];
  changedCategories: PerformanceCategory[];
  summary: string;
};

const PERFORMANCE_CATEGORIES: PerformanceCategory[] = ["cpu", "gpu", "memory", "ssd", "hdd"];
const PERFORMANCE_CATEGORY_LABELS: Record<PerformanceCategory, string> = {
  cpu: "CPU",
  gpu: "GPU",
  memory: "RAM",
  ssd: "SSD",
  hdd: "HDD"
};

function hasSelection(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory.length > 0;
  if (category === "ssd") return build.ssd.length > 0;
  if (category === "hdd") return build.hdd.length > 0;
  return Boolean(build[category]);
}

function labelsFor(categories: PerformanceCategory[]) {
  return categories.map((category) => PERFORMANCE_CATEGORY_LABELS[category]).join(" · ");
}

export function repairPlanPerformanceRetentionFor(build: BuildSelection, plan: RecommendationPlan): RepairPlanPerformanceRetention {
  const selectedCategories = PERFORMANCE_CATEGORIES.filter((category) => hasSelection(build, category));
  const changedSet = new Set(plan.changes.map((change) => change.category));
  const changedCategories = PERFORMANCE_CATEGORIES.filter((category) => changedSet.has(category));
  const retainedCategories = selectedCategories.filter((category) => !changedSet.has(category));

  if (selectedCategories.length === 0 && changedCategories.length === 0) {
    return { status: "unknown", retainedCategories, changedCategories, summary: "카탈로그 성능 기준 비교 불가" };
  }
  if (changedCategories.length === 0) {
    return { status: "preserved", retainedCategories, changedCategories, summary: `카탈로그 성능 기준 유지 · ${labelsFor(retainedCategories)}` };
  }
  if (retainedCategories.length === 0) {
    return { status: "changed", retainedCategories, changedCategories, summary: `카탈로그 성능 기준 변경 · ${labelsFor(changedCategories)}` };
  }
  return {
    status: "mixed",
    retainedCategories,
    changedCategories,
    summary: `성능 기준 유지 · ${labelsFor(retainedCategories)} · 변경 · ${labelsFor(changedCategories)}`
  };
}
