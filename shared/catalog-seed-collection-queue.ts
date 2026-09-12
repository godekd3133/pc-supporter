import type {
  CatalogSeedMappingItem,
  CatalogSeedMappingPreview,
  CatalogSeedMappingReview,
  CatalogSeedMappingStatus
} from "./catalog-seed-mapping";
import { catalogSeedMappingPreviewFor } from "./catalog-seed-mapping";
import type { Part, PartCategory } from "./types";
import { PART_CATEGORIES } from "./types";

export type CatalogSeedCollectionQueueAction = "collect_category" | "search_and_collect" | "recheck_mapping";
export type CatalogSeedCollectionQueuePriority = "high" | "medium" | "low";

export interface CatalogSeedCollectionQueueItem {
  starter: CatalogSeedMappingItem["starter"];
  action: CatalogSeedCollectionQueueAction;
  priority: CatalogSeedCollectionQueuePriority;
  priorityScore: number;
  mappingStatus: CatalogSeedMappingStatus;
  categoryActiveCount: number;
  categoryLiveCount: number;
  suggestedQueries: string[];
  searchUrl: string;
  instructions: string;
}

export interface CatalogSeedCollectionQueueCategoryRow {
  category: PartCategory;
  categoryActiveCount: number;
  categoryLiveCount: number;
  queueCount: number;
  collectCategoryCount: number;
  searchAndCollectCount: number;
  recheckMappingCount: number;
}

export interface CatalogSeedCollectionQueue {
  schemaVersion: 1;
  kind: "catalog-seed-collection-queue";
  generatedAt: string;
  readOnly: true;
  queueFingerprint: string;
  activeCatalogCount: number;
  mappingMissingCount: number;
  summary: {
    queueCount: number;
    highPriorityCount: number;
    mediumPriorityCount: number;
    lowPriorityCount: number;
    collectCategoryCount: number;
    searchAndCollectCount: number;
    recheckMappingCount: number;
  };
  categoryRows: CatalogSeedCollectionQueueCategoryRow[];
  items: CatalogSeedCollectionQueueItem[];
}

const CATEGORY_PRIORITY_BASE: Record<PartCategory, number> = {
  cpu: 92,
  gpu: 90,
  motherboard: 86,
  psu: 82,
  memory: 76,
  cooler: 68,
  ssd: 58,
  hdd: 50,
  case: 46
};

const ACTION_PRIORITY_BONUS: Record<CatalogSeedCollectionQueueAction, number> = {
  recheck_mapping: 12,
  collect_category: 8,
  search_and_collect: 4
};

function categoryIndex(category: PartCategory) {
  return PART_CATEGORIES.indexOf(category);
}

function emptyCategoryCounts() {
  return Object.fromEntries(PART_CATEGORIES.map((category) => [category, 0])) as Record<PartCategory, number>;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function actionFor(item: CatalogSeedMappingItem, categoryLiveCount: number): CatalogSeedCollectionQueueAction {
  if (item.status === "stale") return "recheck_mapping";
  return categoryLiveCount === 0 ? "collect_category" : "search_and_collect";
}

function priorityFor(category: PartCategory, action: CatalogSeedCollectionQueueAction) {
  const priorityScore = CATEGORY_PRIORITY_BASE[category] + ACTION_PRIORITY_BONUS[action];
  const priority: CatalogSeedCollectionQueuePriority = priorityScore >= 80 ? "high" : priorityScore >= 60 ? "medium" : "low";
  return { priority, priorityScore };
}

function searchUrlFor(query: string, searchBaseUrl: string) {
  const separator = searchBaseUrl.includes("?") ? searchBaseUrl.endsWith("?") || searchBaseUrl.endsWith("&") ? "" : "&" : "?";
  return `${searchBaseUrl}${separator}query=${encodeURIComponent(query)}`;
}

function instructionsFor(action: CatalogSeedCollectionQueueAction, categoryLiveCount: number) {
  if (action === "recheck_mapping") return "기존 승인 상품 코드가 현재 catalog에서 사라졌습니다. 새 다나와 상품 코드를 다시 확인하세요.";
  if (action === "collect_category") return "현재 범주에 live 상품이 없습니다. 해당 범주의 목록·상세 수집을 먼저 실행하세요.";
  return `현재 범주에 live 상품 ${categoryLiveCount.toLocaleString("ko-KR")}개가 있지만 일치 후보가 없습니다. 모델명으로 검색한 뒤 목록·상세 수집을 실행하세요.`;
}

function fnv1a(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function catalogSeedCollectionQueueFor(
  starterCatalog: Part[],
  activeCatalog: Part[],
  options: {
    generatedAt?: string;
    reviews?: Record<string, CatalogSeedMappingReview>;
    mappingPreview?: CatalogSeedMappingPreview;
    searchBaseUrl?: string;
  } = {}
): CatalogSeedCollectionQueue {
  const mappingPreview = options.mappingPreview ?? catalogSeedMappingPreviewFor(starterCatalog, activeCatalog, {
    generatedAt: options.generatedAt,
    reviews: options.reviews
  });
  const activeCounts = emptyCategoryCounts();
  const liveCounts = emptyCategoryCounts();
  for (const part of activeCatalog) {
    activeCounts[part.category] += 1;
    if (part.source === "danawa" && part.sourceProductCode) liveCounts[part.category] += 1;
  }

  const searchBaseUrl = options.searchBaseUrl ?? "https://search.danawa.com/dsearch.php";
  const items = mappingPreview.items
    .filter((item) => item.candidates.length === 0 && item.status !== "approved")
    .map((item): CatalogSeedCollectionQueueItem => {
      const category = item.starter.category;
      const action = actionFor(item, liveCounts[category]);
      const { priority, priorityScore } = priorityFor(category, action);
      const suggestedQueries = uniqueStrings([item.starter.model, item.starter.name]);
      const query = suggestedQueries[0] ?? item.starter.id;
      return {
        starter: item.starter,
        action,
        priority,
        priorityScore,
        mappingStatus: item.status,
        categoryActiveCount: activeCounts[category],
        categoryLiveCount: liveCounts[category],
        suggestedQueries,
        searchUrl: searchUrlFor(query, searchBaseUrl),
        instructions: instructionsFor(action, liveCounts[category])
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore || categoryIndex(left.starter.category) - categoryIndex(right.starter.category) || left.starter.name.localeCompare(right.starter.name, "ko-KR") || left.starter.id.localeCompare(right.starter.id));

  const rowByCategory = new Map<PartCategory, CatalogSeedCollectionQueueCategoryRow>(PART_CATEGORIES.map((category) => [category, {
    category,
    categoryActiveCount: activeCounts[category],
    categoryLiveCount: liveCounts[category],
    queueCount: 0,
    collectCategoryCount: 0,
    searchAndCollectCount: 0,
    recheckMappingCount: 0
  }]));
  for (const item of items) {
    const row = rowByCategory.get(item.starter.category);
    if (!row) continue;
    row.queueCount += 1;
    if (item.action === "collect_category") row.collectCategoryCount += 1;
    if (item.action === "search_and_collect") row.searchAndCollectCount += 1;
    if (item.action === "recheck_mapping") row.recheckMappingCount += 1;
  }
  const categoryRows = [...rowByCategory.values()].filter((row) => row.queueCount > 0);
  const fingerprintInput = items.map((item) => JSON.stringify({
    category: item.starter.category,
    id: item.starter.id,
    name: item.starter.name,
    model: item.starter.model,
    brand: item.starter.brand,
    action: item.action,
    priority: item.priority,
    priorityScore: item.priorityScore,
    mappingStatus: item.mappingStatus,
    categoryActiveCount: item.categoryActiveCount,
    categoryLiveCount: item.categoryLiveCount,
    suggestedQueries: item.suggestedQueries
  }));
  // `generatedAt` describes when the snapshot was produced; it must not make
  // an unchanged queue look different on every refresh.
  const queueFingerprint = `seed-collection-${fnv1a([activeCatalog.length, mappingPreview.summary.missingStarterCount, ...fingerprintInput].join("|"))}`;
  const highPriorityCount = items.filter((item) => item.priority === "high").length;
  const mediumPriorityCount = items.filter((item) => item.priority === "medium").length;
  const lowPriorityCount = items.filter((item) => item.priority === "low").length;
  const collectCategoryCount = items.filter((item) => item.action === "collect_category").length;
  const searchAndCollectCount = items.filter((item) => item.action === "search_and_collect").length;
  const recheckMappingCount = items.filter((item) => item.action === "recheck_mapping").length;

  return {
    schemaVersion: 1,
    kind: "catalog-seed-collection-queue",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    readOnly: true,
    queueFingerprint,
    activeCatalogCount: activeCatalog.length,
    mappingMissingCount: mappingPreview.summary.missingStarterCount,
    summary: {
      queueCount: items.length,
      highPriorityCount,
      mediumPriorityCount,
      lowPriorityCount,
      collectCategoryCount,
      searchAndCollectCount,
      recheckMappingCount
    },
    categoryRows,
    items
  };
}
