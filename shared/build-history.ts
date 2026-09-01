import type { BuildSelection, PartCategory, RecommendationPreferences } from "./types";

export interface BuildInputSnapshot {
  build: BuildSelection;
  recommendationPreferences: RecommendationPreferences;
}

export interface BuildHistoryEntry {
  id: string;
  label: string;
  snapshot: BuildInputSnapshot;
  changedAt: string;
}

const BUILD_CATEGORY_KEYS: Array<[PartCategory, keyof BuildSelection]> = [
  ["cpu", "cpu"],
  ["cooler", "cooler"],
  ["motherboard", "motherboard"],
  ["memory", "memory"],
  ["gpu", "gpu"],
  ["ssd", "ssd"],
  ["hdd", "hdd"],
  ["case", "case"],
  ["psu", "psu"]
];

function valueFor(build: BuildSelection, key: keyof BuildSelection) {
  return JSON.stringify(build[key] ?? null);
}

export function changedBuildCategories(before: BuildSelection, after: BuildSelection) {
  return BUILD_CATEGORY_KEYS
    .filter(([, key]) => valueFor(before, key) !== valueFor(after, key))
    .map(([category]) => category);
}

function changedPreferenceLabels(before: RecommendationPreferences, after: RecommendationPreferences) {
  const labels: string[] = [];
  if (before.profile !== after.profile) labels.push("사용 목적");
  if (before.priority !== after.priority) labels.push("추천 우선순위");
  if ((before.gamingResolution ?? null) !== (after.gamingResolution ?? null)) labels.push("게임 해상도");
  const beforeRefreshRate = before.profile === "gaming" ? before.gamingRefreshRate ?? 144 : null;
  const afterRefreshRate = after.profile === "gaming" ? after.gamingRefreshRate ?? 144 : null;
  if (beforeRefreshRate !== null && afterRefreshRate !== null && beforeRefreshRate !== afterRefreshRate) labels.push("게임 주사율");
  if ((before.budgetWon ?? null) !== (after.budgetWon ?? null)) labels.push("목표 예산");
  if ((before.listingPolicy ?? "retail_only") !== (after.listingPolicy ?? "retail_only")) labels.push("구매 조건");
  return labels;
}

const BUILD_CATEGORY_LABELS: Record<PartCategory, string> = {
  cpu: "CPU",
  cooler: "CPU 쿨러",
  motherboard: "메인보드",
  memory: "RAM",
  gpu: "그래픽카드",
  ssd: "SSD",
  hdd: "HDD",
  case: "케이스",
  psu: "파워서플라이"
};

export function buildInputChangeLabel(before: BuildInputSnapshot, after: BuildInputSnapshot) {
  const categories = changedBuildCategories(before.build, after.build).map((category) => BUILD_CATEGORY_LABELS[category]);
  const preferences = changedPreferenceLabels(before.recommendationPreferences, after.recommendationPreferences);
  const labels = [...categories, ...preferences];
  return labels.length > 0 ? labels.join(" · ") + " 변경" : "구성 변경";
}
