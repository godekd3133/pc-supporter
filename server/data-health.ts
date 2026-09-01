import type { AccessoryItem, BuildDataHealth, BuildDataHealthItem, BuildSelection, DataFreshness, Part, PartCategory } from "../shared/types";
import { ACCESSORY_CATEGORIES, isKnownPrice, PART_CATEGORIES } from "../shared/types";
import { classifyDataFreshness } from "../shared/data-freshness";

export { classifyDataFreshness } from "../shared/data-freshness";

function coreSelections(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function buildHealthItem(
  id: string,
  name: string,
  category: PartCategory | BuildDataHealthItem["category"],
  item: Pick<Part, "dataQuality" | "missingFields" | "priceWon" | "updatedAt"> | Pick<AccessoryItem, "dataQuality" | "missingFields" | "priceWon" | "updatedAt"> | undefined,
  now: string | number
): BuildDataHealthItem {
  return {
    id,
    name,
    category,
    dataQuality: item?.dataQuality ?? "incomplete",
    missingFields: item?.missingFields ?? ["catalog item"],
    priceKnown: isKnownPrice(item?.priceWon),
    updatedAt: item?.updatedAt,
    freshness: classifyDataFreshness(item?.updatedAt, now)
  };
}

export function summarizeBuildDataHealth(
  build: BuildSelection,
  catalog: Part[],
  accessories: AccessoryItem[],
  now: string | number = Date.now()
): BuildDataHealth {
  const coreItems = PART_CATEGORIES.flatMap((category) => coreSelections(build, category).map((selection) => {
    const part = catalog.find((candidate) => candidate.id === selection.partId);
    return {
      item: buildHealthItem(selection.partId, part?.name ?? selection.partId, category, part, now),
      quantity: selection.quantity
    };
  }));
  const accessoryItems = (build.accessories ?? []).map((selection) => {
    const accessory = accessories.find((candidate) => candidate.id === selection.accessoryId);
    return {
      item: buildHealthItem(selection.accessoryId, accessory?.name ?? selection.accessoryId, accessory?.category ?? ACCESSORY_CATEGORIES[0], accessory, now),
      quantity: selection.quantity
    };
  });
  const entries = [...coreItems, ...accessoryItems];
  const items = entries.map(({ item }) => item);
  const oldestUpdatedAt = items
    .map((item) => item.updatedAt)
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const freshCount = items.filter((item) => item.freshness === "fresh").length;
  const agingCount = items.filter((item) => item.freshness === "aging").length;
  const staleCount = items.filter((item) => item.freshness === "stale").length;
  const unknownFreshnessCount = items.filter((item) => item.freshness === "unknown").length;
  const incompleteCount = items.filter((item) => item.dataQuality === "incomplete" || item.missingFields.length > 0).length;
  const unpricedCount = items.filter((item) => !item.priceKnown).length;
  const overall: BuildDataHealth["overall"] = staleCount > 0 || unknownFreshnessCount > 0
    ? "needs_refresh"
    : agingCount > 0 || incompleteCount > 0 || unpricedCount > 0
      ? "mixed"
      : "verified";
  return {
    selectedCount: items.length,
    selectedQuantity: entries.reduce((total, entry) => total + entry.quantity, 0),
    freshCount,
    agingCount,
    staleCount,
    unknownFreshnessCount,
    incompleteCount,
    unpricedCount,
    oldestUpdatedAt,
    overall,
    items
  };
}
