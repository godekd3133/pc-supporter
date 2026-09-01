import type { BuildSelection, PartCategory, RecommendationPreferences } from "./types";
import { CATEGORY_LABELS, PART_CATEGORIES } from "./types";

export interface BuildTransferDiffRow {
  id: string;
  label: string;
  before: string;
  after: string;
}

export interface BuildTransferDiff {
  changedCount: number;
  rows: BuildTransferDiffRow[];
}

type BuildTransferDiffNameResolver = {
  partName?: (partId: string) => string | undefined;
  accessoryName?: (accessoryId: string) => string | undefined;
};

const preferenceLabels = {
  profile: { general: "일반형", gaming: "게이밍", creator: "작업·크리에이터", development: "개발·AI", office: "사무·일반" },
  priority: { balanced: "균형형", budget: "가성비 우선", performance: "성능 우선" },
  listingPolicy: { retail_only: "신품·정식 유통", include_bulk: "벌크 포함", all: "전체 조건" },
  gamingResolution: { "1080p": "FHD · 1080p", "1440p": "QHD · 1440p", "4k": "4K · 2160p" },
  gamingRefreshRate: { 60: "60Hz · 기본", 144: "144Hz · 고주사율", 240: "240Hz · 초고주사율" }
} as const;

function selectionListFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  return build[category] ? [build[category]!] : [];
}

function selectionsText(build: BuildSelection, category: PartCategory, resolver: BuildTransferDiffNameResolver) {
  const values = selectionListFor(build, category)
    .map((selection) => `${resolver.partName?.(selection.partId) ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`)
    .sort((left, right) => left.localeCompare(right, "ko-KR"));
  return values.length > 0 ? values.join(", ") : "미선택";
}

function accessoriesText(build: BuildSelection, resolver: BuildTransferDiffNameResolver) {
  const values = (build.accessories ?? [])
    .map((selection) => `${resolver.accessoryName?.(selection.accessoryId) ?? selection.accessoryId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}${selection.targetPartId ? ` · 대상 ${resolver.partName?.(selection.targetPartId) ?? selection.targetPartId}` : ""}${selection.targetAccessoryId ? ` · 대상 허브 ${resolver.accessoryName?.(selection.targetAccessoryId) ?? selection.targetAccessoryId}` : ""}`)
    .sort((left, right) => left.localeCompare(right, "ko-KR"));
  return values.length > 0 ? values.join(", ") : "미선택";
}

function m2Text(build: BuildSelection, resolver: BuildTransferDiffNameResolver) {
  const values = Object.entries(build.m2SlotSelection ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slotId, partId]) => `${slotId}: ${resolver.partName?.(partId) ?? partId}`);
  return values.length > 0 ? values.join(", ") : "자동 배치";
}

function preferencesText(preferences: RecommendationPreferences) {
  const base: string[] = [
    preferenceLabels.profile[preferences.profile],
    preferenceLabels.priority[preferences.priority],
    preferenceLabels.listingPolicy[preferences.listingPolicy ?? "retail_only"]
  ];
  if (preferences.profile === "gaming" && preferences.gamingResolution) base.push(preferenceLabels.gamingResolution[preferences.gamingResolution]);
  if (preferences.profile === "gaming" && preferences.gamingRefreshRate) base.push(preferenceLabels.gamingRefreshRate[preferences.gamingRefreshRate]);
  if (preferences.budgetWon !== undefined) base.push(`예산 ${preferences.budgetWon.toLocaleString("ko-KR")}원`);
  return base.join(" · ");
}

export function buildTransferDiffFor(currentBuild: BuildSelection, currentPreferences: RecommendationPreferences, nextBuild: BuildSelection, nextPreferences: RecommendationPreferences, resolver: BuildTransferDiffNameResolver = {}): BuildTransferDiff {
  const rows: BuildTransferDiffRow[] = [];
  for (const category of PART_CATEGORIES) {
    const before = selectionsText(currentBuild, category, resolver);
    const after = selectionsText(nextBuild, category, resolver);
    if (before !== after) rows.push({ id: `category-${category}`, label: CATEGORY_LABELS[category], before, after });
  }
  const beforeAccessories = accessoriesText(currentBuild, resolver);
  const afterAccessories = accessoriesText(nextBuild, resolver);
  if (beforeAccessories !== afterAccessories) rows.push({ id: "accessories", label: "주변 부품", before: beforeAccessories, after: afterAccessories });
  const beforeM2 = m2Text(currentBuild, resolver);
  const afterM2 = m2Text(nextBuild, resolver);
  if (beforeM2 !== afterM2) rows.push({ id: "m2-slot-selection", label: "M.2 슬롯 배치", before: beforeM2, after: afterM2 });
  const beforeRgbController = currentBuild.rgbControllerAccessoryId ? resolver.accessoryName?.(currentBuild.rgbControllerAccessoryId) ?? currentBuild.rgbControllerAccessoryId : "자동 연결";
  const afterRgbController = nextBuild.rgbControllerAccessoryId ? resolver.accessoryName?.(nextBuild.rgbControllerAccessoryId) ?? nextBuild.rgbControllerAccessoryId : "자동 연결";
  if (beforeRgbController !== afterRgbController) rows.push({ id: "rgb-controller-accessory", label: "RGB 연결 컨트롤러", before: beforeRgbController, after: afterRgbController });
  if (currentBuild.useIntegratedGraphics !== nextBuild.useIntegratedGraphics) rows.push({ id: "integrated-graphics", label: "그래픽 출력", before: currentBuild.useIntegratedGraphics ? "CPU 내장 그래픽" : "외장 그래픽 필요", after: nextBuild.useIntegratedGraphics ? "CPU 내장 그래픽" : "외장 그래픽 필요" });
  const beforePreferences = preferencesText(currentPreferences);
  const afterPreferences = preferencesText(nextPreferences);
  if (beforePreferences !== afterPreferences) rows.push({ id: "recommendation-preferences", label: "추천 기준", before: beforePreferences, after: afterPreferences });
  return { changedCount: rows.length, rows };
}
