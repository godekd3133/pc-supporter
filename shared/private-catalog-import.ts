import { ACCESSORY_CATEGORIES, PART_CATEGORIES, type AccessoryCategory, type Part } from "./types";

export type ReplacementCoverage = {
  complete: boolean;
  missingCategories: string[];
};

export function replacementCoverageFor<T extends { category: string }>(items: T[], categories: readonly string[]): ReplacementCoverage {
  const presentCategories = new Set(items.map((item) => item.category));
  const missingCategories = categories.filter((category) => !presentCategories.has(category));
  return { complete: missingCategories.length === 0, missingCategories };
}

export function coreReplacementCoverageFor(parts: Part[]) {
  return replacementCoverageFor(parts, PART_CATEGORIES);
}

export function accessoryReplacementCoverageFor(items: Array<{ category: AccessoryCategory }>) {
  return replacementCoverageFor(items, ACCESSORY_CATEGORIES);
}

export function assertCompleteReplacementSnapshot(
  flag: "--replace-danawa" | "--replace-accessories",
  coverage: ReplacementCoverage
) {
  if (coverage.complete) return;
  throw new Error(`${flag}를 사용하려면 모든 지원 범주가 포함된 전체 snapshot이 필요합니다. 누락 범주: ${coverage.missingCategories.join(", ")}. 부분 데이터는 ${flag === "--replace-danawa" ? "--apply만 사용해 병합" : "--include-accessories만 사용해 병합"}하세요.`);
}
